"""OpenAI Realtime as the voice model.

Audio goes both ways untouched (Twilio's 8 kHz mu-law is a native model format).
Transcript and tool events are tapped off to the call runtime, which feeds the UI.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from typing import Any, AsyncContextManager

from websockets.asyncio.client import connect as ws_connect

from .agent import TOOLS
from .bridge import MULAW_BYTES_PER_MS, TwilioBridge
from .calls import new_id
from .config import Settings
from .models import CallMode

log = logging.getLogger("callproxy.openai")


class RealtimeBridge(TwilioBridge):
    provider = "voice model"

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        # What the callee has heard of the current agent message, for clean barge-in.
        self.current_item: str | None = None
        self.item_start_ts = 0
        self.item_audio_ms = 0.0

        # Response bookkeeping: the model allows one response at a time.
        self.response_active = False
        self._awaiting_created: str | None = None  # event_id of our in-flight response.create
        self._sent_create: dict[str, Any] | None = None
        self.queue: list[dict[str, Any]] = []
        self.response_had_audio = False

        self.agent_text: dict[str, str] = {}
        self.callee_text: dict[str, str] = {}

    # ---- provider hooks ----------------------------------------------------

    def open_model(self) -> AsyncContextManager[Any]:
        url = f"{self.s.realtime_url}?model={self.s.realtime_model}"
        headers = {"Authorization": f"Bearer {self.s.openai_api_key}"}
        return ws_connect(url, additional_headers=headers, max_size=None)

    async def on_model_open(self) -> None:
        await self._update_session()

    async def _update_session(self) -> None:
        session = session_config(self.s, self.instructions, respond=not self.direct)
        await self.model_send({"type": "session.update", "session": session})

    async def on_caller_audio(self, payload: str) -> None:
        # Always listening: while paused the model still transcribes, it just doesn't reply.
        await self.model_send({"type": "input_audio_buffer.append", "audio": payload})

    async def kickoff(self) -> None:
        if not self._busy():
            await self._request_response()

    async def on_mode(self, mode: CallMode) -> None:
        if mode == "direct":
            self.queue.clear()
            self.current_item = None
            if self.response_active:
                await self.model_send({"type": "response.cancel"})
            await self._update_session()
            return
        await self._update_session()
        await self._system_message(self.rt.handback_brief())
        await self._request_response()

    async def on_typed_line_spoken(self, text: str) -> None:
        if not self.direct:
            user = self.rt.call.task.user_name
            await self._system_message(f'{user} typed this and it was just read to the callee: "{text}"')

    async def speak_without_tts(self, line_id: str, text: str) -> None:
        """No ElevenLabs key: the OpenAI voice reads the typed line instead."""
        self.rt.line_status(line_id, "speaking")
        await self._request_response(_verbatim_response(text, keep_in_conversation=True))
        await asyncio.sleep(0.4 * len(text.split()) + 1)
        self.rt.line_status(line_id, "spoken")

    async def on_model_message(self, ev: dict[str, Any]) -> None:
        t = ev.get("type", "")
        rt = self.rt

        if t in ("response.output_audio.delta", "response.audio.delta"):
            await self._on_audio_delta(ev)

        elif t == "input_audio_buffer.speech_started":
            await self._on_speech_started(ev)

        elif t == "input_audio_buffer.speech_stopped":
            rt.set_activity(callee=False)
            # VAD waits out its silence window before calling the turn, so count that too.
            self.turn_ended_at = time.monotonic() - self.s.vad_silence_ms / 1000

        elif t == "conversation.item.input_audio_transcription.delta":
            item = ev.get("item_id", "")
            self.callee_text[item] = self.callee_text.get(item, "") + ev.get("delta", "")
            rt.transcript(item, "callee", self.callee_text[item], False)

        elif t == "conversation.item.input_audio_transcription.completed":
            item = ev.get("item_id", "")
            self.callee_text.pop(item, None)
            rt.transcript(item, "callee", (ev.get("transcript") or "").strip(), True)

        elif t == "conversation.item.input_audio_transcription.failed":
            rt.transcript(ev.get("item_id", ""), "callee", "(couldn't make that out)", True)

        elif t in ("response.output_audio_transcript.delta", "response.audio_transcript.delta"):
            item = ev.get("item_id", "")
            self.agent_text[item] = self.agent_text.get(item, "") + ev.get("delta", "")
            rt.transcript(item, "agent", self.agent_text[item], False)

        elif t in ("response.output_audio_transcript.done", "response.audio_transcript.done"):
            item = ev.get("item_id", "")
            text = ev.get("transcript") or self.agent_text.get(item, "")
            self.agent_text.pop(item, None)
            rt.transcript(item, "agent", text.strip(), True)

        elif t == "response.created":
            self.response_active = True
            self._awaiting_created = None
            self._sent_create = None
            self.response_had_audio = False

        elif t == "response.output_item.done":
            item = ev.get("item") or {}
            if item.get("type") == "function_call":
                await self._on_function_call(item)

        elif t == "response.done":
            await self._on_response_done()

        elif t == "error":
            await self._on_error(ev)

        elif t in ("session.created", "session.updated"):
            log.info("model %s", t)

    # ---- events --------------------------------------------------------------

    async def _on_audio_delta(self, ev: dict[str, Any]) -> None:
        payload = ev.get("delta", "")
        item_id = ev.get("item_id")
        if item_id != self.current_item:
            self.current_item = item_id
            self.item_start_ts = self.latest_media_ts
            self.item_audio_ms = 0.0
        self.response_had_audio = True
        self.item_audio_ms += len(base64.b64decode(payload)) / MULAW_BYTES_PER_MS
        await self.play(payload)

    async def _on_speech_started(self, ev: dict[str, Any]) -> None:
        self.callee_spoke = True
        self.turn_ended_at = None
        self.rt.set_activity(callee=True)
        item_id = ev.get("item_id")
        if item_id:
            # Placeholder bubble so the user sees the callee is talking before the words arrive.
            self.rt.transcript(item_id, "callee", "", False)
        if self.agent_audio_playing and self.current_item and not self.direct and not self.injecting:
            # Barge-in: trim what the model thinks it said, flush Twilio's queue, stop the response.
            played = min(max(self.latest_media_ts - self.item_start_ts, 0), int(self.item_audio_ms))
            await self.model_send(
                {
                    "type": "conversation.item.truncate",
                    "item_id": self.current_item,
                    "content_index": 0,
                    "audio_end_ms": played,
                }
            )
            await self.flush_playback()
            self.current_item = None
        if self.response_active:
            await self.model_send({"type": "response.cancel"})

    async def _on_function_call(self, item: dict[str, Any]) -> None:
        name = item.get("name", "")
        call_id = item.get("call_id", "")
        try:
            args = json.loads(item.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        log.info("tool %s %s", name, args)

        if self.direct:
            await self._send_tool_output(call_id, {"skipped": True, "note": "The user is typing directly. Stay quiet."})
            return
        if name == "end_call":
            # No result goes back to the model: we just hang up once the goodbye has played.
            self.rt.end_call(str(args.get("reason", "")))
            self.hangup_requested = True
            self.queue.clear()
            if not self.response_active:
                await self.send_hangup_mark()
            return

        if name == "ask_user":
            if not self.response_had_audio:
                # The spec promises the callee hears this before the pause.
                await self._request_response(_verbatim_response("One moment, let me check."))
            self.rt.spawn(self._finish_tool(name, call_id, args))
            return

        await self._finish_tool(name, call_id, args)

    async def _finish_tool(self, name: str, call_id: str, args: dict[str, Any]) -> None:
        result = await self.rt.handle_tool(name, args)
        if self.closed or self.hangup_requested:
            return
        await self._send_tool_output(call_id, result)
        if not self.direct:
            await self._request_response()

    async def _send_tool_output(self, call_id: str, result: dict[str, Any]) -> None:
        await self.model_send(
            {
                "type": "conversation.item.create",
                "item": {"type": "function_call_output", "call_id": call_id, "output": json.dumps(result)},
            }
        )

    async def _on_response_done(self) -> None:
        self.response_active = False
        if self.hangup_requested:
            self.queue.clear()
            await self.send_hangup_mark()
            return
        if self.queue and not self._awaiting_created:
            await self._send_create(self.queue.pop(0))

    async def _on_error(self, ev: dict[str, Any]) -> None:
        err = ev.get("error") or {}
        code = err.get("code")
        if code == "response_cancel_not_active":
            return
        log.warning("model error: %s", err)
        self.last_error = err.get("message") or code
        if self._awaiting_created and err.get("event_id") == self._awaiting_created:
            sent = self._sent_create
            self._awaiting_created = None
            self._sent_create = None
            if code == "conversation_already_has_active_response" and sent:
                self.queue.insert(0, sent)  # retry once the current response finishes
            elif self.queue and not self.response_active:
                await self._send_create(self.queue.pop(0))

    # ---- response queue --------------------------------------------------------

    def _busy(self) -> bool:
        return self.response_active or self._awaiting_created is not None

    async def _request_response(self, response: dict[str, Any] | None = None) -> None:
        event: dict[str, Any] = {"type": "response.create"}
        if response:
            event["response"] = response
        if self._busy() or self.queue:
            self.queue.append(event)
        else:
            await self._send_create(event)

    async def _send_create(self, event: dict[str, Any]) -> None:
        event = dict(event, event_id=new_id("evt_"))
        self._awaiting_created = event["event_id"]
        self._sent_create = {k: v for k, v in event.items() if k != "event_id"}
        await self.model_send(event)

    # ---- VoiceLink (called by the runtime / UI) ----------------------------------

    async def deliver_late_answer(self, question: str, answer: str) -> None:
        user = self.rt.call.task.user_name
        await self._system_message(
            f'{user} has now answered your earlier question "{question}": "{answer}". '
            "Tell the callee and continue the call."
        )
        await self._request_response()

    async def warn_time_running_out(self, seconds_left: int) -> None:
        await self._system_message(
            f"About {seconds_left} seconds are left on this call. Wrap up now: record_outcome, "
            "a quick read-back, goodbye, then end_call."
        )
        await self._request_response()

    async def _system_message(self, text: str) -> None:
        await self.model_send(
            {
                "type": "conversation.item.create",
                "item": {"type": "message", "role": "system", "content": [{"type": "input_text", "text": text}]},
            }
        )


def session_config(s: Settings, instructions: str, *, respond: bool = True) -> dict[str, Any]:
    """Phone audio in and out (8 kHz mu-law, no resampling), server-side turn detection,
    transcripts of both sides, and the agent's tools. With respond=False the model keeps
    transcribing but stays quiet, for when the user is typing the call themselves."""
    audio_in: dict[str, Any] = {
        "format": {"type": "audio/pcmu"},
        "transcription": {"model": s.transcribe_model, "language": "en"},
        "turn_detection": {
            "type": "server_vad",
            "threshold": s.vad_threshold,
            "prefix_padding_ms": s.vad_prefix_ms,
            "silence_duration_ms": s.vad_silence_ms,
            "create_response": respond,
            "interrupt_response": respond,
        },
    }
    if s.noise_reduction in ("near_field", "far_field"):
        audio_in["noise_reduction"] = {"type": s.noise_reduction}
    return {
        "type": "realtime",
        "model": s.realtime_model,
        "output_modalities": ["audio"],
        "instructions": instructions,
        "tools": TOOLS,
        "tool_choice": "auto",
        "audio": {
            "input": audio_in,
            "output": {"format": {"type": "audio/pcmu"}, "voice": s.voice},
        },
    }


def _verbatim_response(text: str, *, keep_in_conversation: bool = False) -> dict[str, Any]:
    """A response that says exactly `text`. Fillers stay out of the conversation history;
    the user's typed lines go into it so the agent knows it said them."""
    response: dict[str, Any] = {
        "instructions": f'Say exactly this, word for word, and nothing else: "{text}"',
        "tool_choice": "none",
        "output_modalities": ["audio"],
    }
    if not keep_in_conversation:
        response["conversation"] = "none"
        response["input"] = [
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": f'Say: "{text}"'}]}
        ]
    return response
