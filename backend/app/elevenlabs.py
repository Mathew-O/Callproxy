"""ElevenLabs Agents as the voice model.

ElevenLabs runs speech recognition, the LLM, turn-taking, and its own voices; we keep
the Twilio bridge so the live transcript, decision cards, and guardrails work exactly
as with any other provider. Phone audio (ulaw_8000) passes through untouched.

The agent and its three client tools are created and kept in sync over the API, so
there's nothing to click through in the ElevenLabs dashboard. Each call overrides the
agent's prompt with that call's task.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import time
from typing import Any, AsyncContextManager

import httpx
from websockets.asyncio.client import connect as ws_connect

from .agent import TOOLS
from .bridge import TwilioBridge
from .calls import new_id
from .config import Settings
from .models import CallMode

log = logging.getLogger("callproxy.elevenlabs")

AGENT_NAME = "CallProxy phone agent"
PHONE_AUDIO = "ulaw_8000"
CLIENT_EVENTS = [
    "conversation_initiation_metadata",
    "ping",
    "audio",
    "interruption",
    "user_transcript",
    "tentative_user_transcript",
    "agent_response",
    "agent_response_correction",
    "agent_chat_response_part",
    "client_tool_call",
    "client_error",
]
# The real prompt arrives per call as an override; this only shows in the dashboard.
PLACEHOLDER_PROMPT = (
    "You are CallProxy, an AI assistant that makes phone calls on behalf of a user. "
    "Each call replaces this prompt with that call's task."
)


# Tests swap in a fake socket for Scribe separately from the agent's.
scribe_connect: Any = None


class ElevenLabsError(RuntimeError):
    pass


def tool_configs(settings: Settings) -> list[dict[str, Any]]:
    """The agent's client tools, from the same definitions the OpenAI agent uses."""
    configs = []
    for tool in TOOLS:
        name = tool["name"]
        configs.append(
            {
                "type": "client",
                "name": name,
                "description": tool["description"],
                "parameters": tool["parameters"],
                # end_call needs no answer; we hang up once the goodbye has played.
                "expects_response": name != "end_call",
                # ask_user waits on a person, so give it longer than our own timeout.
                "response_timeout_secs": min(int(settings.ask_user_timeout_s) + 15, 120) if name == "ask_user" else 20,
                # "One moment, let me check" before the pause.
                "pre_tool_speech": "force" if name == "ask_user" else "auto",
            }
        )
    return configs


def agent_payload(settings: Settings, tool_ids: list[str]) -> dict[str, Any]:
    return {
        "name": AGENT_NAME,
        "tags": ["callproxy"],
        "conversation_config": {
            "asr": {"quality": "high", "provider": "elevenlabs", "user_input_audio_format": PHONE_AUDIO},
            "turn": {"turn_timeout": 7, "turn_eagerness": settings.elevenlabs_turn_eagerness},
            "tts": {
                "model_id": settings.elevenlabs_tts_model,
                "voice_id": settings.elevenlabs_voice_id,
                "agent_output_audio_format": PHONE_AUDIO,
            },
            "conversation": {
                "max_duration_seconds": settings.max_call_seconds + 15,
                "client_events": CLIENT_EVENTS,
            },
            "agent": {
                # Empty: wait for the callee's "hello?" instead of talking over it.
                "first_message": "",
                "language": "en",
                "prompt": {
                    "prompt": PLACEHOLDER_PROMPT,
                    "llm": settings.elevenlabs_llm,
                    "temperature": 0.3,
                    "tool_ids": tool_ids,
                },
            },
        },
        "platform_settings": {
            "overrides": {
                "conversation_config_override": {
                    "agent": {"prompt": {"prompt": True}, "first_message": True, "language": True},
                    "tts": {"voice_id": True},
                    "conversation": {"text_only": True},
                }
            }
        },
    }


class ElevenLabsClient:
    """REST calls: keep the agent and tools in sync, sign conversation URLs, and TTS."""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.s = settings
        self._transport = transport
        self._agent_id: str | None = None
        self._lock = asyncio.Lock()

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.s.elevenlabs_base_url,
            headers={"xi-api-key": self.s.elevenlabs_api_key},
            timeout=httpx.Timeout(20.0),
            transport=self._transport,
        )

    async def _request(self, http: httpx.AsyncClient, method: str, path: str, **kwargs: Any) -> Any:
        try:
            res = await http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise ElevenLabsError(f"Couldn't reach ElevenLabs ({type(exc).__name__}).") from exc
        if res.status_code >= 400:
            raise ElevenLabsError(f"ElevenLabs said: {_error_text(res)}")
        return res.json() if res.headers.get("content-type", "").startswith("application/json") else res.content

    async def ensure_agent(self) -> str:
        """Create the CallProxy agent (or update it to match this code) once per process."""
        async with self._lock:
            if self._agent_id:
                return self._agent_id
            async with self._http() as http:
                tool_ids = await self._sync_tools(http)
                payload = agent_payload(self.s, tool_ids)
                agent_id = self.s.elevenlabs_agent_id or await self._find_agent(http)
                if agent_id:
                    await self._request(http, "PATCH", f"/v1/convai/agents/{agent_id}", json=payload)
                    log.info("updated ElevenLabs agent %s", agent_id)
                else:
                    created = await self._request(http, "POST", "/v1/convai/agents/create", json=payload)
                    agent_id = created["agent_id"]
                    log.info("created ElevenLabs agent %s", agent_id)
            self._agent_id = agent_id
            return agent_id

    async def _sync_tools(self, http: httpx.AsyncClient) -> list[str]:
        listing = await self._request(http, "GET", "/v1/convai/tools")
        existing = {
            (t.get("tool_config") or {}).get("name"): t["id"]
            for t in listing.get("tools", [])
            if (t.get("tool_config") or {}).get("type") == "client"
        }
        ids = []
        for config in tool_configs(self.s):
            tool_id = existing.get(config["name"])
            if tool_id:
                await self._request(http, "PATCH", f"/v1/convai/tools/{tool_id}", json={"tool_config": config})
            else:
                tool_id = (await self._request(http, "POST", "/v1/convai/tools", json={"tool_config": config}))["id"]
            ids.append(tool_id)
        return ids

    async def _find_agent(self, http: httpx.AsyncClient) -> str | None:
        listing = await self._request(http, "GET", "/v1/convai/agents", params={"search": AGENT_NAME})
        for agent in listing.get("agents", []):
            if agent.get("name") == AGENT_NAME:
                return agent["agent_id"]
        return None

    async def signed_url(self, agent_id: str) -> str:
        async with self._http() as http:
            data = await self._request(
                http, "GET", "/v1/convai/conversation/get-signed-url", params={"agent_id": agent_id}
            )
        return data["signed_url"]

    async def synthesize(self, text: str, voice_id: str | None = None, output_format: str = PHONE_AUDIO) -> bytes:
        """Text to speech. Phone audio for typed lines on a call; mp3 for browser previews."""
        async with self._http() as http:
            audio = await self._request(
                http,
                "POST",
                f"/v1/text-to-speech/{voice_id or self.s.elevenlabs_voice_id}",
                params={"output_format": output_format},
                json={"text": text, "model_id": "eleven_flash_v2_5"},
            )
        if not isinstance(audio, bytes):
            raise ElevenLabsError("ElevenLabs returned no audio.")
        return audio

    async def phone_tts(self, text: str, voice_id: str | None) -> bytes:
        return await self.synthesize(text, voice_id, PHONE_AUDIO)

    async def voices(self) -> list[dict[str, Any]]:
        async with self._http() as http:
            data = await self._request(http, "GET", "/v2/voices", params={"page_size": 100})
        return list(data.get("voices", []))


def _error_text(res: httpx.Response) -> str:
    try:
        detail = res.json().get("detail")
    except (ValueError, AttributeError):
        return f"HTTP {res.status_code}"
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("status") or detail)
    if isinstance(detail, list):
        return "; ".join(f"{'.'.join(map(str, d.get('loc', [])))}: {d.get('msg')}" for d in detail)
    return str(detail or f"HTTP {res.status_code}")


class ScribeCaptions:
    """ElevenLabs realtime speech-to-text for the callee while the agent is paused, so
    captions keep flowing when the user types the call themselves."""

    FRAMES_PER_CHUNK = 5  # Twilio sends 20 ms frames; send Scribe 100 ms at a time

    def __init__(self, settings: Settings, on_partial: Any, on_final: Any):
        self.s = settings
        self.on_partial = on_partial
        self.on_final = on_final
        self.ws: Any = None
        self._frames: list[bytes] = []
        self._reader: asyncio.Task[None] | None = None
        self._context: Any = None

    @property
    def url(self) -> str:
        base = self.s.elevenlabs_base_url.replace("https://", "wss://").replace("http://", "ws://")
        return (
            f"{base}/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format={PHONE_AUDIO}"
            "&commit_strategy=vad&language_code=en"
        )

    async def start(self) -> None:
        connect = scribe_connect or ws_connect
        self._context = connect(self.url, additional_headers={"xi-api-key": self.s.elevenlabs_api_key}, max_size=None)
        self.ws = await self._context.__aenter__()
        self._reader = asyncio.create_task(self._read())

    async def send(self, payload: str) -> None:
        if self.ws is None:
            return
        self._frames.append(base64.b64decode(payload))
        if len(self._frames) < self.FRAMES_PER_CHUNK:
            return
        chunk, self._frames = b"".join(self._frames), []
        await self.ws.send(
            json.dumps(
                {
                    "message_type": "input_audio_chunk",
                    "audio_base_64": base64.b64encode(chunk).decode(),
                    "commit": False,
                    "sample_rate": 8000,
                }
            )
        )

    async def _read(self) -> None:
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                kind = msg.get("message_type", "")
                if kind == "partial_transcript":
                    self.on_partial(msg.get("text") or "")
                elif kind == "committed_transcript":
                    self.on_final(msg.get("text") or "")
                elif kind.endswith("error") or kind in ("quota_exceeded", "rate_limited", "invalid_request"):
                    log.warning("Scribe error: %s", msg)
        except Exception:  # noqa: BLE001 - captions dropping shouldn't drop the call
            log.warning("Scribe captions stopped", exc_info=True)

    async def close(self) -> None:
        if self._reader:
            self._reader.cancel()
        if self._context is not None:
            with contextlib.suppress(Exception):
                await self._context.__aexit__(None, None, None)
        self.ws = None
        self._context = None


class ElevenLabsBridge(TwilioBridge):
    provider = "ElevenLabs agent"

    def __init__(self, *args: Any, client: ElevenLabsClient, signed_url: str, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.client = client
        self.signed_url = signed_url
        self.callee_turn: str | None = None  # id of the callee line being transcribed
        self.agent_parts: dict[str, str] = {}
        self._callee_quiet: asyncio.Task[None] | None = None
        self.captions: ScribeCaptions | None = None

    # ---- provider hooks ----------------------------------------------------

    def open_model(self) -> AsyncContextManager[Any]:
        return ws_connect(self.signed_url, max_size=None)

    async def on_model_open(self) -> None:
        task = self.rt.call.task
        await self.model_send(
            {
                "type": "conversation_initiation_client_data",
                "conversation_config_override": {
                    "agent": {"prompt": {"prompt": self.instructions}, "language": "en"},
                    "tts": {"voice_id": task.agent_voice_id or self.s.elevenlabs_voice_id},
                },
            }
        )
        if self.direct:
            await self._start_captions()

    async def on_caller_audio(self, payload: str) -> None:
        # Paused agent: the callee's audio goes to Scribe for captions instead.
        if self.direct and self.captions:
            await self.captions.send(payload)
        elif not self.direct:
            await self.model_send({"user_audio_chunk": payload})

    async def kickoff(self) -> None:
        await self.model_send(
            {
                "type": "user_message",
                "text": "(The person picked up but hasn't said anything yet. Greet them and introduce yourself.)",
            }
        )

    async def on_mode(self, mode: CallMode) -> None:
        if mode == "direct":
            await self._start_captions()
            return
        await self._stop_captions()
        # Brief the agent on what it missed, then have it pick the call back up.
        await self.model_send({"type": "contextual_update", "text": self.rt.handback_brief()})
        await self.model_send(
            {
                "type": "user_message",
                "text": f"(Note from {self.rt.call.task.user_name} through the app: I've handed the call back to you. Carry on.)",
            }
        )

    async def on_typed_line_spoken(self, text: str) -> None:
        if self.direct:
            return  # the hand-back brief covers everything said while paused
        user = self.rt.call.task.user_name
        await self.model_send(
            {
                "type": "contextual_update",
                "text": f'{user} typed this and it was just read to the callee in their voice: "{text}"',
            }
        )

    async def on_closed(self) -> None:
        await self._stop_captions()

    async def on_model_message(self, msg: dict[str, Any]) -> None:
        t = msg.get("type", "")
        rt = self.rt
        paused = self.direct

        if t == "audio":
            payload = (msg.get("audio_event") or {}).get("audio_base_64")
            if payload and not paused:
                await self.play(payload)

        elif t == "ping":
            await self.model_send({"type": "pong", "event_id": (msg.get("ping_event") or {}).get("event_id")})

        elif t == "interruption":
            # ElevenLabs already stopped generating; drop what Twilio still has queued.
            if not self.injecting:
                await self.flush_playback()

        elif t == "tentative_user_transcript" and not paused:
            event = msg.get("tentative_user_transcription_event") or msg.get("tentative_user_transcript_event") or {}
            self._callee_partial(event.get("user_transcript", ""))

        elif t == "user_transcript" and not paused:
            text = ((msg.get("user_transcription_event") or {}).get("user_transcript") or "").strip()
            self._callee_final(text)

        elif t == "agent_chat_response_part" and not paused:
            part = msg.get("text_response_part") or {}
            rid = part.get("response_id") or "current"
            if part.get("type") == "start":
                self.agent_parts[rid] = ""
            elif part.get("type") == "delta":
                self.agent_parts[rid] = self.agent_parts.get(rid, "") + part.get("text", "")
                rt.transcript(f"el_a_{rid}", "agent", self.agent_parts[rid], False)

        elif t == "agent_response" and not paused:
            event = msg.get("agent_response_event") or {}
            rid = event.get("response_id") or str(event.get("event_id") or new_id())
            self.agent_parts.pop(rid, None)
            rt.transcript(f"el_a_{rid}", "agent", (event.get("agent_response") or "").strip(), True)

        elif t == "agent_response_correction" and not paused:
            # Sent when the callee cut the agent off: the text becomes what was actually said.
            event = msg.get("agent_response_correction_event") or {}
            rid = event.get("response_id")
            corrected = (event.get("corrected_agent_response") or "").strip()
            turn_id = f"el_a_{rid}" if rid else self._last_agent_turn()
            if turn_id and corrected:
                rt.transcript(turn_id, "agent", corrected, True)

        elif t == "client_tool_call":
            await self._on_tool_call(msg.get("client_tool_call") or {})

        elif t == "conversation_initiation_metadata":
            meta = msg.get("conversation_initiation_metadata_event") or {}
            log.info("ElevenLabs conversation %s", meta.get("conversation_id"))
            formats = {meta.get("agent_output_audio_format"), meta.get("user_input_audio_format")}
            if formats - {PHONE_AUDIO, None}:
                self.last_error = (
                    f"The ElevenLabs agent isn't using phone audio ({', '.join(sorted(map(str, formats)))}). "
                    "Restart the backend so CallProxy can resync the agent."
                )
                await self.model.close()

        elif t in ("error", "client_error"):
            detail = msg.get("error") or msg.get("message") or msg
            log.warning("ElevenLabs error: %s", detail)
            self.last_error = f"ElevenLabs error: {detail.get('message') if isinstance(detail, dict) else detail}"

    # ---- callee captions -------------------------------------------------------

    def _callee_partial(self, text: str) -> None:
        self._callee_talking()
        self.callee_turn = self.callee_turn or new_id("el_c_")
        self.rt.transcript(self.callee_turn, "callee", text, False)

    def _callee_final(self, text: str) -> None:
        self.callee_spoke = True
        turn = self.callee_turn or new_id("el_c_")
        self.callee_turn = None
        self.rt.transcript(turn, "callee", text.strip(), True)
        self.rt.set_activity(callee=False)
        self.turn_ended_at = time.monotonic()

    async def _start_captions(self) -> None:
        if self.captions:
            return
        self.captions = ScribeCaptions(self.s, self._callee_partial, self._callee_final)
        try:
            await self.captions.start()
        except Exception:  # noqa: BLE001
            log.warning("couldn't start Scribe captions", exc_info=True)
            self.captions = None

    async def _stop_captions(self) -> None:
        if self.captions:
            captions, self.captions = self.captions, None
            await captions.close()

    # ---- tools ---------------------------------------------------------------------

    async def _on_tool_call(self, call: dict[str, Any]) -> None:
        name = call.get("tool_name", "")
        tool_call_id = call.get("tool_call_id", "")
        params = call.get("parameters") or {}
        log.info("tool %s %s", name, params)

        if self.direct:
            # Paused: the user is doing the talking, so the agent doesn't act.
            await self._tool_result(tool_call_id, {"skipped": True, "note": "The user is typing directly. Stay quiet."})
            return
        if name == "end_call":
            self.rt.end_call(str(params.get("reason", "")))
            self.hangup_requested = True
            if call.get("expects_response"):
                await self._tool_result(tool_call_id, {"ok": True})
            self.rt.spawn(self._hang_up_once_quiet())
            return
        if name == "ask_user":
            self.rt.spawn(self._finish_tool(name, tool_call_id, params))
            return
        await self._finish_tool(name, tool_call_id, params)

    async def _finish_tool(self, name: str, tool_call_id: str, params: dict[str, Any]) -> None:
        result = await self.rt.handle_tool(name, params)
        if not self.closed and not self.hangup_requested:
            await self._tool_result(tool_call_id, result)

    async def _tool_result(self, tool_call_id: str, result: dict[str, Any]) -> None:
        await self.model_send(
            {
                "type": "client_tool_result",
                "tool_call_id": tool_call_id,
                "result": json.dumps(result),
                "is_error": "error" in result,
            }
        )

    async def _hang_up_once_quiet(self) -> None:
        """The goodbye may still be streaming when end_call arrives. Wait for its audio to
        start and then go quiet before marking the end of playback."""
        started = time.monotonic()
        while time.monotonic() - started < 10:
            waited = time.monotonic() - started
            quiet_for = time.monotonic() - self.last_audio_at
            if waited > 1.5 and quiet_for > 0.8:
                break
            await asyncio.sleep(0.1)
        await self.send_hangup_mark()

    # ---- activity ----------------------------------------------------------------

    def _callee_talking(self) -> None:
        self.callee_spoke = True
        self.turn_ended_at = None
        self.rt.set_activity(callee=True)
        if self._callee_quiet:
            self._callee_quiet.cancel()
        self._callee_quiet = self.rt.spawn(self._callee_quiet_after(1.5))

    async def _callee_quiet_after(self, seconds: float) -> None:
        await asyncio.sleep(seconds)
        self.rt.set_activity(callee=False)

    def _last_agent_turn(self) -> str | None:
        for turn in reversed(self.rt.call.transcript):
            if turn.speaker == "agent":
                return turn.id
        return None

    # ---- VoiceLink ---------------------------------------------------------------

    async def deliver_late_answer(self, question: str, answer: str) -> None:
        user = self.rt.call.task.user_name
        await self.model_send(
            {
                "type": "user_message",
                "text": (
                    f"(Message from {user} through the app, not from the person on the phone: "
                    f'my answer to "{question}" is "{answer}". Tell them now and continue.)'
                ),
            }
        )

    async def warn_time_running_out(self, seconds_left: int) -> None:
        await self.model_send(
            {
                "type": "contextual_update",
                "text": (
                    f"About {seconds_left} seconds are left on this call. Wrap up now: record_outcome, "
                    "a quick read-back, goodbye, then end_call."
                ),
            }
        )
