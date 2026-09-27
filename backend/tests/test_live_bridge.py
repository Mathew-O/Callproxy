"""Drives a live call through a fake Twilio Media Stream and a fake Realtime model."""

from __future__ import annotations

import asyncio
import base64
import json
import threading
from typing import Any

import pytest
from twilio.request_validator import RequestValidator

from app import bridge, main, realtime
from app.calls import store

from .conftest import Collector, wait_until

TASK = {
    "to_number": "+12155550142",
    "callee_name": "Dr. Rivera's office",
    "user_name": "Sam Lee",
    "goal": "Book a teeth cleaning",
    "facts": {"Date of birth": "March 14, 2004"},
    "constraints": ["Tuesday or Thursday afternoons"],
}


class FakeModel:
    """Stands in for the OpenAI Realtime websocket."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.url = ""
        self.headers: dict[str, str] = {}
        self.connected = threading.Event()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.queue: asyncio.Queue[dict[str, Any] | None] | None = None

    def connect(self, url: str, additional_headers: dict[str, str] | None = None, max_size: Any = None) -> "FakeModel":
        self.url, self.headers = url, additional_headers or {}
        return self

    async def close(self) -> None:
        assert self.queue is not None
        self.queue.put_nowait(None)

    async def __aenter__(self) -> "FakeModel":
        self.loop = asyncio.get_running_loop()
        self.queue = asyncio.Queue()
        self.connected.set()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def send(self, data: str) -> None:
        self.sent.append(json.loads(data))

    def __aiter__(self) -> "FakeModel":
        return self

    async def __anext__(self) -> str:
        assert self.queue is not None
        event = await self.queue.get()
        if event is None:
            raise StopAsyncIteration
        return json.dumps(event)

    def emit(self, **event: Any) -> None:
        assert self.loop and self.queue
        self.loop.call_soon_threadsafe(self.queue.put_nowait, event)

    def of_type(self, kind: str) -> list[dict[str, Any]]:
        return [e for e in list(self.sent) if e.get("type") == kind]

    def wait_sent(self, kind: str, count: int = 1, what: str | None = None) -> dict[str, Any]:
        return wait_until(lambda: len(self.of_type(kind)) >= count and self.of_type(kind)[count - 1], what=what or kind)

    def respond_to_latest_create(self) -> None:
        """Answer the last response.create the bridge sent, like the real API would."""
        self.emit(type="response.created", response={"id": "resp"})


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> FakeModel:
    fake = FakeModel()
    monkeypatch.setattr(realtime, "ws_connect", fake.connect)
    monkeypatch.setattr(bridge, "KICKOFF_AFTER_S", 60)  # keep the agent from speaking first mid-test
    return fake


@pytest.fixture
def phone(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    calls: dict[str, Any] = {"placed": [], "hangups": []}

    async def place_call(call_id: str, to_number: str) -> str:
        calls["placed"].append((call_id, to_number))
        return "CA" + "1" * 32

    async def hangup(sid: str, *, ringing: bool = False) -> None:
        calls["hangups"].append((sid, ringing))

    monkeypatch.setattr(main.telephony, "place_call", place_call)
    monkeypatch.setattr(main.telephony, "hangup", hangup)
    return calls


def audio(ms: int) -> str:
    return base64.b64encode(b"\xff" * (ms * 8)).decode()


def test_full_live_call_through_the_bridge(client, live_settings, model, phone):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    assert phone["placed"] == [(call_id, "+12155550142")]
    rt = store.runtime(call_id)

    with client.websocket_connect(f"/ws/calls/{call_id}") as ui_ws, client.websocket_connect(
        f"/twilio/media/{call_id}"
    ) as tw_ws:
        ui = Collector(ui_ws)
        tw_ws.send_json({"event": "connected", "protocol": "Call", "version": "1.0.0"})
        tw_ws.send_json(
            {
                "event": "start",
                "start": {"streamSid": "MZ1", "callSid": "CA1", "customParameters": {"token": rt.stream_token}},
            }
        )
        twilio = Collector(tw_ws)

        # Session is configured for phone audio, our tools, and our prompt.
        session = model.wait_sent("session.update")["session"]
        assert model.url.endswith("?model=gpt-realtime")
        assert model.headers["Authorization"] == "Bearer sk-test"
        assert session["audio"]["input"]["format"] == {"type": "audio/pcmu"}
        assert session["audio"]["output"]["format"] == {"type": "audio/pcmu"}
        assert session["audio"]["input"]["turn_detection"]["type"] == "server_vad"
        assert {t["name"] for t in session["tools"]} == {"ask_user", "record_outcome", "end_call"}
        assert "calling on behalf of Sam Lee" in session["instructions"]
        ui.wait_for(lambda e: e["type"] == "status" and e["data"]["state"] == "in_progress", "in progress")

        # Callee audio is forwarded untouched.
        tw_ws.send_json({"event": "media", "media": {"timestamp": "20", "payload": audio(20)}})
        assert model.wait_sent("input_audio_buffer.append")["audio"] == audio(20)

        # Callee speaks: placeholder bubble, then the transcribed words.
        model.emit(type="input_audio_buffer.speech_started", item_id="c1", audio_start_ms=0)
        ui.wait_for(lambda e: e["type"] == "transcript" and e["data"]["id"] == "c1", "callee placeholder")
        model.emit(type="input_audio_buffer.speech_stopped", item_id="c1")
        model.emit(
            type="conversation.item.input_audio_transcription.completed",
            item_id="c1",
            transcript="Dr. Rivera's office, how can I help?",
        )
        ui.wait_for(
            lambda e: e["type"] == "transcript" and e["data"]["final"] and e["data"]["speaker"] == "callee",
            "callee line",
        )

        # Agent answers: audio goes to Twilio with a mark, words go to the UI.
        model.emit(type="response.created", response={"id": "r1"})
        model.emit(type="response.output_audio.delta", item_id="a1", delta=audio(400))
        model.emit(type="response.output_audio_transcript.delta", item_id="a1", delta="Hi, I'm an AI")
        media = twilio.wait_for(lambda m: m["event"] == "media", "agent audio")
        assert media["streamSid"] == "MZ1" and media["media"]["payload"] == audio(400)
        twilio.wait_for(lambda m: m["event"] == "mark", "mark")
        wait_until(lambda: rt.call.response_gaps_ms, what="latency sample")

        # Barge-in: the callee talks over the agent.
        tw_ws.send_json({"event": "media", "media": {"timestamp": "120", "payload": audio(20)}})
        model.wait_sent("input_audio_buffer.append", 2)
        model.emit(type="input_audio_buffer.speech_started", item_id="c2", audio_start_ms=100)
        twilio.wait_for(lambda m: m["event"] == "clear", "twilio clear")
        truncate = model.wait_sent("conversation.item.truncate")
        assert truncate["item_id"] == "a1" and truncate["audio_end_ms"] == 100
        model.wait_sent("response.cancel")
        model.emit(type="response.output_audio_transcript.done", item_id="a1", transcript="Hi, I'm an AI assistant.")
        model.emit(type="response.done", response={"id": "r1", "status": "cancelled"})
        model.emit(type="conversation.item.input_audio_transcription.completed", item_id="c2", transcript="")
        # An empty transcription (just noise) removes the placeholder bubble.
        wait_until(lambda: all(t.id != "c2" for t in rt.call.transcript), what="noise bubble removed")

        # The agent asks the user; it didn't speak first, so the bridge adds the filler line.
        model.emit(type="response.created", response={"id": "r2"})
        model.emit(
            type="response.output_item.done",
            item={
                "type": "function_call",
                "name": "ask_user",
                "call_id": "fc1",
                "arguments": json.dumps({"question": "Which works?", "options": ["Thu 3 PM", "Fri 10 AM"]}),
            },
        )
        ask = ui.wait_for(lambda e: e["type"] == "ask_user", "decision card")["data"]
        assert ask["options"] == ["Thu 3 PM", "Fri 10 AM"]
        assert rt.call.state == "waiting_on_user"
        model.emit(type="response.done", response={"id": "r2"})
        filler = model.wait_sent("response.create")
        assert filler["response"]["conversation"] == "none"
        assert "One moment, let me check." in filler["response"]["instructions"]
        model.emit(type="response.created", response={"id": "r3"})

        # The user taps an option; the answer goes back as the tool result once the filler finishes.
        client.post(f"/calls/{call_id}/reply", json={"question_id": ask["question_id"], "answer": "Thu 3 PM"})
        output = model.wait_sent("conversation.item.create")
        assert output["item"]["call_id"] == "fc1"
        assert json.loads(output["item"]["output"]) == {"answered": True, "answer": "Thu 3 PM"}
        assert len(model.of_type("response.create")) == 1  # queued behind the filler
        model.emit(type="response.done", response={"id": "r3"})
        model.wait_sent("response.create", 2)
        assert rt.call.state == "in_progress"

        # The agent records the outcome.
        model.emit(type="response.created", response={"id": "r4"})
        model.emit(
            type="response.output_item.done",
            item={
                "type": "function_call",
                "name": "record_outcome",
                "call_id": "fc2",
                "arguments": json.dumps(
                    {
                        "status": "success",
                        "summary": "Booked Thursday 3 PM.",
                        "details": {"date": "2026-10-01", "time": "15:00", "confirmation_number": "RC-4821"},
                    }
                ),
            },
        )
        outcome = ui.wait_for(lambda e: e["type"] == "outcome", "outcome")["data"]
        assert outcome["details"]["confirmation_number"] == "RC-4821"
        ui.wait_for(lambda e: e["type"] == "status" and e["data"]["state"] == "wrapping_up", "wrapping up")
        model.emit(type="response.done", response={"id": "r4"})
        model.wait_sent("response.create", 3)

        # Goodbye then end_call: hang up only after Twilio says the goodbye finished playing.
        model.emit(type="response.created", response={"id": "r5"})
        model.emit(type="response.output_audio.delta", item_id="a5", delta=audio(200))
        model.emit(
            type="response.output_item.done",
            item={"type": "function_call", "name": "end_call", "call_id": "fc3", "arguments": '{"reason": "done"}'},
        )
        model.emit(type="response.done", response={"id": "r5"})
        twilio.wait_for(lambda m: m["event"] == "mark" and m["mark"]["name"] == "hangup", "hangup mark")
        assert phone["hangups"] == []
        tw_ws.send_json({"event": "mark", "mark": {"name": "hangup"}})
        wait_until(lambda: phone["hangups"], what="hangup via Twilio")
        tw_ws.send_json({"event": "stop"})

        final = ui.wait_for(lambda e: e["type"] == "snapshot" and e["data"]["state"] == "completed", "completed")
    assert final["data"]["outcome"]["status"] == "success"
    assert len(model.of_type("response.create")) == 3  # nothing queued after the goodbye


def test_media_stream_with_wrong_token_is_rejected(client, live_settings, model, phone):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    with client.websocket_connect(f"/twilio/media/{call_id}") as tw_ws:
        tw_ws.send_json({"event": "start", "start": {"streamSid": "MZ1", "customParameters": {"token": "nope"}}})
        with pytest.raises(Exception):
            tw_ws.receive_json()
    assert not model.connected.is_set()
    assert store.get(call_id).state == "dialing"


def test_callee_hanging_up_early_fails_the_call(client, live_settings, model, phone):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    rt = store.runtime(call_id)
    with client.websocket_connect(f"/twilio/media/{call_id}") as tw_ws:
        tw_ws.send_json(
            {"event": "start", "start": {"streamSid": "MZ1", "customParameters": {"token": rt.stream_token}}}
        )
        model.wait_sent("session.update")
        tw_ws.send_json({"event": "stop"})
        wait_until(lambda: rt.call.state == "failed", what="failed")
    assert rt.call.detail == "The other side hung up before the task was finished."


def _signed_post(client, path: str, params: dict[str, str]):
    url = f"https://callproxy.example.test{path}"
    signature = RequestValidator("test-auth-token").compute_signature(url, params)
    return client.post(path, data=params, headers={"X-Twilio-Signature": signature})


def test_twilio_webhooks(client, live_settings, phone):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    rt = store.runtime(call_id)

    assert client.post(f"/twilio/voice/{call_id}", data={"CallSid": "CA1"}).status_code == 403  # unsigned

    twiml = _signed_post(client, f"/twilio/voice/{call_id}", {"CallSid": "CA1"}).text
    assert f'<Stream url="wss://callproxy.example.test/twilio/media/{call_id}">' in twiml
    assert f'<Parameter name="token" value="{rt.stream_token}"' in twiml

    _signed_post(client, f"/twilio/status/{call_id}", {"CallSid": "CA1", "CallStatus": "ringing"})
    assert rt.call.state == "ringing"
    _signed_post(client, f"/twilio/status/{call_id}", {"CallSid": "CA1", "CallStatus": "no-answer"})
    assert rt.call.state == "no_answer"
    assert "No one picked up" in rt.call.detail

    # A finished call gets a hang-up instead of a stream.
    assert "<Hangup" in _signed_post(client, f"/twilio/voice/{call_id}", {"CallSid": "CA1"}).text


def test_busy_line_is_no_answer(client, live_settings, phone):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    _signed_post(client, f"/twilio/status/{call_id}", {"CallSid": "CA1", "CallStatus": "busy"})
    assert store.get(call_id).state == "no_answer"
    assert store.get(call_id).detail == "The line was busy."


def test_model_error_is_shown_to_the_user(client, live_settings, model, phone):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    rt = store.runtime(call_id)
    with client.websocket_connect(f"/twilio/media/{call_id}") as tw_ws:
        tw_ws.send_json(
            {"event": "start", "start": {"streamSid": "MZ1", "customParameters": {"token": rt.stream_token}}}
        )
        model.wait_sent("session.update")
        model.emit(
            type="error",
            error={"type": "insufficient_quota", "code": "credit_balance_exhausted", "message": "No credits left."},
        )
        model.loop.call_soon_threadsafe(model.queue.put_nowait, None)  # the API then closes the socket
        wait_until(lambda: rt.call.state == "failed", what="failed")
    assert rt.call.detail == "The voice model disconnected: No credits left."
    assert phone["hangups"], "the phone call is hung up rather than left silent"


def test_openai_take_over_and_hand_back(client, live_settings, model, phone):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    rt = store.runtime(call_id)
    with client.websocket_connect(f"/twilio/media/{call_id}") as tw_ws:
        tw_ws.send_json(
            {"event": "start", "start": {"streamSid": "MZ1", "customParameters": {"token": rt.stream_token}}}
        )
        first = model.wait_sent("session.update")["session"]["audio"]["input"]["turn_detection"]
        assert first["create_response"] is True

        # Take over: the model keeps transcribing but stops replying.
        client.post(f"/calls/{call_id}/mode", json={"mode": "direct"})
        paused = model.wait_sent("session.update", 2)["session"]["audio"]["input"]["turn_detection"]
        assert paused["create_response"] is False and paused["interrupt_response"] is False
        tw_ws.send_json({"event": "media", "media": {"timestamp": "20", "payload": audio(20)}})
        model.wait_sent("input_audio_buffer.append")
        model.emit(type="conversation.item.input_audio_transcription.completed", item_id="c1", transcript="Hello?")
        wait_until(lambda: any(t.text == "Hello?" for t in rt.call.transcript), what="captions while paused")

        # No ElevenLabs key: the OpenAI voice reads the typed line instead.
        line_id = client.post(f"/calls/{call_id}/say", json={"text": "Hi, it's Sam."}).json()["line_id"]
        verbatim = model.wait_sent("response.create")
        assert "Hi, it's Sam." in verbatim["response"]["instructions"]
        wait_until(lambda: next(t for t in rt.call.transcript if t.id == line_id).status == "speaking", what="speaking")

        # Hand back: replies back on, briefed on what was said, and it speaks.
        model.emit(type="response.created", response={"id": "r1"})
        model.emit(type="response.done", response={"id": "r1"})
        client.post(f"/calls/{call_id}/mode", json={"mode": "agent"})
        resumed = model.wait_sent("session.update", 3)["session"]["audio"]["input"]["turn_detection"]
        assert resumed["create_response"] is True
        brief = next(m for m in model.of_type("conversation.item.create") if m["item"].get("role") == "system")
        assert "Hello?" in brief["item"]["content"][0]["text"]
        model.wait_sent("response.create", 2)
        tw_ws.send_json({"event": "stop"})
        wait_until(lambda: rt.call.state in ("completed", "failed"), what="ended")
