"""The Twilio half of a live call, shared by every voice provider.

Handles the Media Stream handshake, plays the agent's audio with marks so we know what
the callee has actually heard, flushes playback on barge-in, reports who is speaking,
reads the user's typed lines in their ElevenLabs voice, and hangs up only after the
goodbye has played. Subclasses plug in the voice model.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import time
from typing import Any, AsyncContextManager, Awaitable, Callable

from fastapi import WebSocket

from .calls import CallRuntime
from .config import Settings
from .models import TERMINAL_STATES, CallMode

log = logging.getLogger("callproxy.bridge")

MULAW_BYTES_PER_MS = 8  # 8 kHz, one byte per sample
KICKOFF_AFTER_S = 2.0  # speak first if the callee hasn't said anything by then
TTS_CHUNK_BYTES = 1600  # 200 ms of mu-law per media message

# (text, voice_id) -> phone audio (8 kHz mu-law bytes)
PhoneTts = Callable[[str, "str | None"], Awaitable[bytes]]


class TwilioBridge:
    provider = "voice model"

    def __init__(
        self,
        twilio_ws: WebSocket,
        runtime: CallRuntime,
        settings: Settings,
        instructions: str,
        tts: PhoneTts | None = None,
    ):
        self.twilio = twilio_ws
        self.rt = runtime
        self.s = settings
        self.instructions = instructions
        self.tts = tts
        self.model: Any = None
        self.stream_sid: str | None = None
        self.closed = False
        self._twilio_lock = asyncio.Lock()
        self._model_lock = asyncio.Lock()

        self.latest_media_ts = 0  # ms, from Twilio's inbound frames
        self.pending_marks = 0  # audio chunks sent to Twilio that haven't played yet
        self.last_audio_at = 0.0  # monotonic time the last agent audio chunk went out
        self.callee_spoke = False
        self.last_error: str | None = None  # shown to the user if the model drops the call
        # Callee turn end -> agent's first audio, for the "how fast is it?" number.
        self.turn_ended_at: float | None = None

        # Typed lines play one at a time; the agent's audio waits while one is going out.
        self._typed_lock = asyncio.Lock()
        self._typed_played: dict[str, asyncio.Event] = {}
        self.injecting = False
        self.held_audio: list[str] = []

        self.hangup_requested = False
        self.hangup_mark_sent = False
        self.hangup_mark_played = asyncio.Event()

    @property
    def direct(self) -> bool:
        return self.rt.call.mode == "direct"

    # ---- provider hooks ----------------------------------------------------

    def open_model(self) -> AsyncContextManager[Any]:
        raise NotImplementedError

    async def on_model_open(self) -> None:
        """Configure the session once the model socket is open."""

    async def on_caller_audio(self, payload: str) -> None:
        raise NotImplementedError

    async def on_model_message(self, message: dict[str, Any]) -> None:
        raise NotImplementedError

    async def kickoff(self) -> None:
        """Make the agent speak first (the callee picked up but stayed quiet)."""

    async def on_mode(self, mode: CallMode) -> None:
        """Pause the agent (direct) or brief it and hand the call back (agent)."""

    async def on_typed_line_spoken(self, text: str) -> None:
        """Tell the model a typed line was said, so its picture of the call stays right."""

    async def speak_without_tts(self, line_id: str, text: str) -> None:
        """No ElevenLabs key: providers that have their own voice can read the line."""
        log.warning("no TTS available to read a typed line")
        self.rt.line_status(line_id, "failed")

    # ---- lifecycle -----------------------------------------------------------

    async def run(self) -> None:
        if not await self._wait_for_start():
            return
        rt = self.rt
        rt.stream_connected = True
        rt.voice = self  # type: ignore[assignment]
        rt.mark_answered()
        failure: str | None = None
        try:
            async with self.open_model() as model:
                self.model = model
                await self.on_model_open()
                tasks = {
                    asyncio.create_task(self._pump_twilio(), name="twilio"),
                    asyncio.create_task(self._pump_model(), name="model"),
                }
                kickoff = asyncio.create_task(self._kickoff_if_silent())
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                kickoff.cancel()
                for task in pending:
                    task.cancel()
                for task in done:
                    if task.get_name() == "model" and rt.call.state not in TERMINAL_STATES:
                        reason = self.last_error or task.exception()
                        failure = f"The {self.provider} disconnected{f': {reason}' if reason else '.'}"
                    elif task.exception():
                        raise task.exception()  # type: ignore[misc]
        except Exception as exc:  # noqa: BLE001
            log.exception("bridge error on call %s", rt.call.id)
            failure = self.last_error or f"Couldn't keep the {self.provider} connected ({type(exc).__name__}: {exc})."
        finally:
            self.closed = True
            rt.voice = None
            rt.set_activity(agent=False, callee=False, you=False)
            await self.on_closed()
        if failure:
            await rt.hang_up("error")
            rt.finish(failure)
        else:
            rt.finish()

    async def on_closed(self) -> None:
        """Release anything the provider opened besides the model socket."""

    async def _wait_for_start(self) -> bool:
        """Read Twilio's 'connected' and 'start' messages and check the call token."""
        async for message in self.twilio.iter_text():
            data = json.loads(message)
            if data.get("event") == "start":
                start = data["start"]
                token = (start.get("customParameters") or {}).get("token")
                if token != self.rt.stream_token or self.rt.stream_connected:
                    log.warning("rejected media stream for %s (bad token or duplicate)", self.rt.call.id)
                    await self.twilio.close(code=1008)
                    return False
                self.stream_sid = start["streamSid"]
                return True
        return False

    async def _kickoff_if_silent(self) -> None:
        await asyncio.sleep(KICKOFF_AFTER_S)
        # When the user is typing, the first words are theirs.
        if not self.callee_spoke and not self.hangup_requested and not self.direct:
            log.info("callee silent; agent speaks first on %s", self.rt.call.id)
            await self.kickoff()

    async def _pump_twilio(self) -> None:
        async for message in self.twilio.iter_text():
            data = json.loads(message)
            event = data.get("event")
            if event == "media":
                self.latest_media_ts = int(data["media"].get("timestamp", self.latest_media_ts))
                # Once the agent is saying goodbye, stop listening so nothing restarts the chat.
                if not self.hangup_requested:
                    await self.on_caller_audio(data["media"]["payload"])
            elif event == "mark":
                self.pending_marks = max(0, self.pending_marks - 1)
                if self.pending_marks == 0:
                    self.rt.set_activity(agent=False)
                name = data.get("mark", {}).get("name", "")
                if name == "hangup":
                    self.hangup_mark_played.set()
                elif name.startswith("typed:") and name[6:] in self._typed_played:
                    self._typed_played[name[6:]].set()
            elif event == "stop":
                log.info("media stream stopped for %s", self.rt.call.id)
                return

    async def _pump_model(self) -> None:
        async for raw in self.model:
            message = json.loads(raw)
            try:
                await self.on_model_message(message)
            except Exception:  # noqa: BLE001 - one bad event shouldn't drop the call
                log.exception("error handling %s message", self.provider)

    # ---- playback --------------------------------------------------------------

    async def _send_audio(self, payload: str) -> None:
        await self.twilio_send({"event": "media", "streamSid": self.stream_sid, "media": {"payload": payload}})
        await self.twilio_send({"event": "mark", "streamSid": self.stream_sid, "mark": {"name": "audio"}})
        self.pending_marks += 1

    async def play(self, payload: str) -> None:
        """Queue one chunk of agent audio (base64 mu-law) on the call."""
        if self.injecting:
            self.held_audio.append(payload)
            return
        if self.turn_ended_at is not None:
            self.rt.call.response_gaps_ms.append(int((time.monotonic() - self.turn_ended_at) * 1000))
            self.turn_ended_at = None
        self.last_audio_at = time.monotonic()
        await self._send_audio(payload)
        self.rt.set_activity(agent=True)

    async def flush_playback(self) -> None:
        """Drop whatever agent audio Twilio still has queued (the callee cut in)."""
        await self.twilio_send({"event": "clear", "streamSid": self.stream_sid})
        self.pending_marks = 0
        self.held_audio.clear()
        self.rt.set_activity(agent=False)

    @property
    def agent_audio_playing(self) -> bool:
        return self.pending_marks > 0

    # ---- the user's typed lines ------------------------------------------------

    async def speak_typed(self, line_id: str, text: str, voice_id: str | None) -> None:
        async with self._typed_lock:
            rt = self.rt
            if self.closed:
                rt.line_status(line_id, "failed")
                return
            if self.tts is None:
                await self.speak_without_tts(line_id, text)
                return
            try:
                audio = await self.tts(text, voice_id)
            except Exception as exc:  # noqa: BLE001
                log.warning("couldn't voice a typed line: %s", exc)
                rt.line_status(line_id, "failed")
                return
            # Let the agent finish its sentence first; Twilio plays chunks in the order sent.
            for _ in range(80):
                if not self.agent_audio_playing:
                    break
                await asyncio.sleep(0.1)
            played = self._typed_played[line_id] = asyncio.Event()
            rt.line_status(line_id, "speaking")
            rt.set_activity(you=True)
            self.injecting = True
            try:
                for i in range(0, len(audio), TTS_CHUNK_BYTES):
                    await self._send_audio(base64.b64encode(audio[i : i + TTS_CHUNK_BYTES]).decode())
                await self.twilio_send(
                    {"event": "mark", "streamSid": self.stream_sid, "mark": {"name": f"typed:{line_id}"}}
                )
            finally:
                self.injecting = False
                held, self.held_audio = self.held_audio, []
                for payload in held:
                    await self.play(payload)
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(played.wait(), timeout=len(audio) / (MULAW_BYTES_PER_MS * 1000) + 3)
            self._typed_played.pop(line_id, None)
            rt.set_activity(you=False)
            rt.line_status(line_id, "spoken")
            await self.on_typed_line_spoken(text)

    async def set_mode(self, mode: CallMode) -> None:
        if mode == "direct" and self.agent_audio_playing and not self.injecting:
            # The user is taking over: cut the agent off mid-sentence.
            await self.flush_playback()
        await self.on_mode(mode)

    # ---- hanging up --------------------------------------------------------------

    async def send_hangup_mark(self) -> None:
        if self.hangup_mark_sent:
            return
        self.hangup_mark_sent = True
        await self.twilio_send({"event": "mark", "streamSid": self.stream_sid, "mark": {"name": "hangup"}})
        self.rt.spawn(self._hang_up_after_playback())

    async def _hang_up_after_playback(self) -> None:
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self.hangup_mark_played.wait(), timeout=10)
        await asyncio.sleep(0.3)  # don't clip the last syllable
        await self.rt.hang_up("agent")

    # ---- plumbing ------------------------------------------------------------------

    async def twilio_send(self, obj: dict[str, Any]) -> None:
        if self.closed:
            return
        async with self._twilio_lock:
            try:
                await self.twilio.send_text(json.dumps(obj))
            except Exception:  # noqa: BLE001 - the call may have just ended
                log.debug("twilio send failed", exc_info=True)

    async def model_send(self, obj: dict[str, Any]) -> None:
        if self.model is None or self.closed:
            return
        async with self._model_lock:
            await self.model.send(json.dumps(obj))
