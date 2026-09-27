"""ElevenLabs: agent provisioning over REST, and a live call through the Agents websocket."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from app import bridge, elevenlabs, main
from app.calls import store
from app.config import settings
from app.elevenlabs import AGENT_NAME, ElevenLabsClient, ElevenLabsError

from .conftest import Collector, wait_until
from .test_live_bridge import TASK, FakeModel, audio


class FakeElevenLabsApi:
    """Records requests and answers like the ElevenLabs REST API."""

    def __init__(self, tools: list[dict[str, Any]] | None = None, agents: list[dict[str, Any]] | None = None):
        self.requests: list[tuple[str, str, Any]] = []
        self.tools = tools or []
        self.agents = agents or []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.requests.append((request.method, request.url.path, body))
        assert request.headers["xi-api-key"] == "xi-test"
        path = request.url.path
        if request.method == "GET" and path == "/v1/convai/tools":
            return httpx.Response(200, json={"tools": self.tools})
        if request.method == "POST" and path == "/v1/convai/tools":
            return httpx.Response(200, json={"id": f"tool_{body['tool_config']['name']}"})
        if request.method == "GET" and path == "/v1/convai/agents":
            return httpx.Response(200, json={"agents": self.agents})
        if request.method == "POST" and path == "/v1/convai/agents/create":
            return httpx.Response(200, json={"agent_id": "agent_new"})
        if request.method == "PATCH":
            return httpx.Response(200, json={})
        if path == "/v1/convai/conversation/get-signed-url":
            return httpx.Response(200, json={"signed_url": f"wss://el.test/convai?agent={request.url.params['agent_id']}"})
        return httpx.Response(404, json={"detail": {"message": "not found"}})


@pytest.fixture
def el_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "elevenlabs_api_key", "xi-test")


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def test_first_run_creates_tools_and_a_phone_ready_agent(el_settings):
    api = FakeElevenLabsApi()
    client = ElevenLabsClient(settings, transport=httpx.MockTransport(api.handler))
    assert run(client.ensure_agent()) == "agent_new"

    created_tools = [body["tool_config"] for method, path, body in api.requests if path == "/v1/convai/tools" and method == "POST"]
    assert [t["name"] for t in created_tools] == ["ask_user", "record_outcome", "end_call"]
    ask = created_tools[0]
    assert ask["type"] == "client" and ask["expects_response"] and ask["pre_tool_speech"] == "force"
    assert ask["response_timeout_secs"] > settings.ask_user_timeout_s
    assert created_tools[2]["expects_response"] is False
    # Every parameter carries a description, which ElevenLabs requires.
    for tool in created_tools:
        for prop in tool["parameters"]["properties"].values():
            assert prop.get("description")

    agent = next(body for method, path, body in api.requests if path == "/v1/convai/agents/create")
    conv = agent["conversation_config"]
    assert agent["name"] == AGENT_NAME
    assert conv["asr"]["user_input_audio_format"] == "ulaw_8000"
    assert conv["tts"]["agent_output_audio_format"] == "ulaw_8000"
    assert conv["agent"]["first_message"] == ""
    assert conv["agent"]["prompt"]["tool_ids"] == ["tool_ask_user", "tool_record_outcome", "tool_end_call"]
    assert "client_tool_call" in conv["conversation"]["client_events"]
    assert agent["platform_settings"]["overrides"]["conversation_config_override"]["agent"]["prompt"]["prompt"]

    # Cached for the rest of the process.
    count = len(api.requests)
    run(client.ensure_agent())
    assert len(api.requests) == count


def test_later_runs_update_the_existing_agent_and_tools(el_settings):
    api = FakeElevenLabsApi(
        tools=[{"id": "t1", "tool_config": {"type": "client", "name": "ask_user"}}],
        agents=[{"agent_id": "agent_old", "name": AGENT_NAME}, {"agent_id": "other", "name": "Something else"}],
    )
    client = ElevenLabsClient(settings, transport=httpx.MockTransport(api.handler))
    assert run(client.ensure_agent()) == "agent_old"
    calls = [(m, p) for m, p, _ in api.requests]
    assert ("PATCH", "/v1/convai/tools/t1") in calls
    assert ("PATCH", "/v1/convai/agents/agent_old") in calls
    assert ("POST", "/v1/convai/agents/create") not in calls
    assert run(client.signed_url("agent_old")) == "wss://el.test/convai?agent=agent_old"


def test_api_errors_become_readable(el_settings):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": {"status": "invalid_api_key", "message": "Invalid API key"}})

    client = ElevenLabsClient(settings, transport=httpx.MockTransport(handler))
    with pytest.raises(ElevenLabsError, match="Invalid API key"):
        run(client.ensure_agent())


def test_bad_key_is_reported_before_dialing(client, live_settings, el_settings, monkeypatch):
    async def fail() -> str:
        raise ElevenLabsError("ElevenLabs said: Invalid API key")

    placed: list[str] = []

    async def place_call(call_id: str, to: str) -> str:
        placed.append(call_id)
        return "CA1"

    monkeypatch.setattr(main.elevenlabs, "ensure_agent", fail)
    monkeypatch.setattr(main.telephony, "place_call", place_call)
    res = client.post("/calls", json=TASK)
    assert res.status_code == 502
    assert "Invalid API key" in res.json()["detail"]
    assert placed == []


@pytest.fixture
def el_live(client, live_settings, el_settings, monkeypatch):
    """A live ElevenLabs call with the phone and the ElevenLabs API faked out."""
    model = FakeModel()
    monkeypatch.setattr(elevenlabs, "ws_connect", model.connect)
    monkeypatch.setattr(bridge, "KICKOFF_AFTER_S", 60)
    phone: dict[str, list[Any]] = {"hangups": []}
    spoken: list[tuple[str, str | None]] = []

    async def ensure_agent() -> str:
        return "agent_1"

    async def signed_url(agent_id: str) -> str:
        return f"wss://el.test/convai?agent={agent_id}&token=abc"

    async def phone_tts(text: str, voice_id: str | None) -> bytes:
        spoken.append((text, voice_id))
        return b"\xff" * 4000  # 500 ms of audio: three chunks

    async def place_call(call_id: str, to: str) -> str:
        return "CA1"

    async def hangup(sid: str, *, ringing: bool = False) -> None:
        phone["hangups"].append(sid)

    monkeypatch.setattr(main.elevenlabs, "ensure_agent", ensure_agent)
    monkeypatch.setattr(main.elevenlabs, "signed_url", signed_url)
    monkeypatch.setattr(main.elevenlabs, "phone_tts", phone_tts)
    monkeypatch.setattr(main.telephony, "place_call", place_call)
    monkeypatch.setattr(main.telephony, "hangup", hangup)
    return {"model": model, "phone": phone, "spoken": spoken}


def _start(tw_ws: Any, rt: Any) -> None:
    tw_ws.send_json({"event": "start", "start": {"streamSid": "MZ1", "customParameters": {"token": rt.stream_token}}})


def test_full_elevenlabs_call(client, el_live):
    model: FakeModel = el_live["model"]
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    rt = store.runtime(call_id)
    assert rt.call.voice_provider == "elevenlabs"
    assert client.get("/config").json()["voice_provider"] == "elevenlabs"

    with client.websocket_connect(f"/ws/calls/{call_id}") as ui_ws, client.websocket_connect(
        f"/twilio/media/{call_id}"
    ) as tw_ws:
        ui = Collector(ui_ws)
        _start(tw_ws, rt)
        twilio = Collector(tw_ws)

        init = model.wait_sent("conversation_initiation_client_data")
        assert model.url == "wss://el.test/convai?agent=agent_1&token=abc"
        assert "calling on behalf of Sam Lee" in init["conversation_config_override"]["agent"]["prompt"]["prompt"]
        model.emit(
            type="conversation_initiation_metadata",
            conversation_initiation_metadata_event={
                "conversation_id": "conv_1",
                "agent_output_audio_format": "ulaw_8000",
                "user_input_audio_format": "ulaw_8000",
            },
        )

        # Phone audio goes straight through, and pings get pongs.
        tw_ws.send_json({"event": "media", "media": {"timestamp": "20", "payload": audio(20)}})
        wait_until(lambda: any(m.get("user_audio_chunk") == audio(20) for m in model.sent), what="audio forwarded")
        model.emit(type="ping", ping_event={"event_id": 7, "ping_ms": 50})
        assert model.wait_sent("pong")["event_id"] == 7

        # The callee talks: a live partial line and a speaking indicator, then the final line.
        model.emit(type="tentative_user_transcript", tentative_user_transcription_event={"user_transcript": "Dr. Rivera's"})
        ui.wait_for(lambda e: e["type"] == "activity" and e["data"]["callee"], "callee speaking")
        ui.wait_for(lambda e: e["type"] == "transcript" and e["data"]["text"] == "Dr. Rivera's", "partial line")
        model.emit(type="user_transcript", user_transcription_event={"user_transcript": "Dr. Rivera's office, hi!", "event_id": 2})
        wait_until(
            lambda: [t.text for t in rt.call.transcript if t.speaker == "callee" and t.final] == ["Dr. Rivera's office, hi!"],
            what="final callee line replaces the partial",
        )

        # The agent answers: audio plays on the call, text lands in the transcript.
        model.emit(type="audio", audio_event={"audio_base_64": audio(300), "event_id": 3})
        media = twilio.wait_for(lambda m: m["event"] == "media", "agent audio")
        assert media["media"]["payload"] == audio(300)
        ui.wait_for(lambda e: e["type"] == "activity" and e["data"]["agent"], "agent speaking")
        wait_until(lambda: rt.call.response_gaps_ms, what="latency sample")
        model.emit(
            type="agent_response",
            agent_response_event={"agent_response": "Hi, I'm an AI assistant calling for Sam Lee.", "response_id": "r1"},
        )

        # Barge-in: flush queued audio, and the transcript shows what was actually said.
        model.emit(type="interruption", interruption_event={"event_id": 4})
        twilio.wait_for(lambda m: m["event"] == "clear", "twilio clear")
        model.emit(
            type="agent_response_correction",
            agent_response_correction_event={
                "original_agent_response": "Hi, I'm an AI assistant calling for Sam Lee.",
                "corrected_agent_response": "Hi, I'm an AI assistant...",
                "response_id": "r1",
            },
        )
        wait_until(
            lambda: any(t.id == "el_a_r1" and t.text == "Hi, I'm an AI assistant..." for t in rt.call.transcript),
            what="corrected agent line",
        )

        # ask_user round trip through a client tool.
        model.emit(
            type="client_tool_call",
            client_tool_call={
                "tool_name": "ask_user",
                "tool_call_id": "tc1",
                "parameters": {"question": "Which works?", "options": ["Thu 3 PM", "Fri 10 AM"]},
                "expects_response": True,
            },
        )
        ask = ui.wait_for(lambda e: e["type"] == "ask_user", "decision card")["data"]
        client.post(f"/calls/{call_id}/reply", json={"question_id": ask["question_id"], "answer": "Thu 3 PM"})
        result = model.wait_sent("client_tool_result")
        assert result["tool_call_id"] == "tc1" and result["is_error"] is False
        assert json.loads(result["result"]) == {"answered": True, "answer": "Thu 3 PM"}

        # Type-to-speak: the user's line is read in their ElevenLabs voice, then the agent is told.
        tw_ws.send_json({"event": "mark", "mark": {"name": "audio"}})  # earlier agent audio finished
        res = client.post(f"/calls/{call_id}/say", json={"text": "Please text me the address.", "voice_id": "voice_me"})
        line_id = res.json()["line_id"]
        wait_until(lambda: el_live["spoken"], what="tts request")
        assert el_live["spoken"] == [("Please text me the address.", "voice_me")]
        ui.wait_for(
            lambda e: e["type"] == "transcript" and e["data"]["id"] == line_id and e["data"]["status"] == "speaking",
            "line speaking",
        )
        ui.wait_for(lambda e: e["type"] == "activity" and e["data"]["you"], "your voice speaking")
        mark = twilio.wait_for(lambda m: m["event"] == "mark" and m["mark"]["name"] == f"typed:{line_id}", "typed mark")
        assert len([m for m in twilio.messages if m["event"] == "media"]) >= 4
        tw_ws.send_json({"event": "mark", "mark": mark["mark"]})  # Twilio: finished playing it
        ui.wait_for(
            lambda e: e["type"] == "transcript" and e["data"]["id"] == line_id and e["data"]["status"] == "spoken",
            "line spoken",
        )
        update = model.wait_sent("contextual_update")
        assert "Please text me the address." in update["text"]
        line = next(t for t in rt.call.transcript if t.id == line_id)
        assert (line.speaker, line.via, line.voice) == ("user", "typed", "Custom voice")

        model.emit(
            type="client_tool_call",
            client_tool_call={
                "tool_name": "record_outcome",
                "tool_call_id": "tc2",
                "parameters": {"status": "success", "summary": "Booked Thursday 3 PM.", "details": {"time": "15:00"}},
                "expects_response": True,
            },
        )
        ui.wait_for(lambda e: e["type"] == "outcome", "outcome")
        assert json.loads(model.wait_sent("client_tool_result", 2)["result"])["saved"] is True

        # Goodbye then end_call: hang up only once the goodbye has streamed and played.
        model.emit(type="audio", audio_event={"audio_base_64": audio(200), "event_id": 9})
        model.emit(
            type="client_tool_call",
            client_tool_call={"tool_name": "end_call", "tool_call_id": "tc3", "parameters": {"reason": "done"}, "expects_response": False},
        )
        twilio.wait_for(lambda m: m["event"] == "mark" and m["mark"]["name"] == "hangup", "hangup mark", timeout=6)
        assert el_live["phone"]["hangups"] == []
        tw_ws.send_json({"event": "mark", "mark": {"name": "hangup"}})
        wait_until(lambda: el_live["phone"]["hangups"], what="hangup via Twilio")
        tw_ws.send_json({"event": "stop"})
        final = ui.wait_for(lambda e: e["type"] == "snapshot" and e["data"]["state"] == "completed", "completed")
    assert final["data"]["outcome"]["status"] == "success"
    assert final["data"]["speaking"] == {"agent": False, "callee": False, "you": False}


def test_agent_with_wrong_audio_format_fails_clearly(client, el_live):
    model: FakeModel = el_live["model"]
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    rt = store.runtime(call_id)
    with client.websocket_connect(f"/twilio/media/{call_id}") as tw_ws:
        _start(tw_ws, rt)
        model.wait_sent("conversation_initiation_client_data")
        model.emit(
            type="conversation_initiation_metadata",
            conversation_initiation_metadata_event={"agent_output_audio_format": "pcm_16000", "user_input_audio_format": "pcm_16000"},
        )
        wait_until(lambda: rt.call.state == "failed", what="failed")
    assert "isn't using phone audio" in rt.call.detail
    assert el_live["phone"]["hangups"]


def test_silent_callee_gets_a_greeting(client, el_live, monkeypatch):
    monkeypatch.setattr(bridge, "KICKOFF_AFTER_S", 0.2)
    model: FakeModel = el_live["model"]
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    rt = store.runtime(call_id)
    with client.websocket_connect(f"/twilio/media/{call_id}") as tw_ws:
        _start(tw_ws, rt)
        nudge = model.wait_sent("user_message")
        assert "introduce yourself" in nudge["text"]
        tw_ws.send_json({"event": "stop"})
        wait_until(lambda: rt.call.state == "failed", what="ended")


def test_provider_choice(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "sk")
    assert settings.voice_provider == "openai"
    monkeypatch.setattr(settings, "elevenlabs_api_key", "xi")
    assert settings.voice_provider == "elevenlabs"
    monkeypatch.setattr(settings, "voice_provider_setting", "openai")
    assert settings.voice_provider == "openai"


class FakeScribe(FakeModel):
    """Stands in for ElevenLabs realtime speech-to-text."""


def test_taking_over_pauses_the_agent_and_captions_via_scribe(client, el_live, monkeypatch):
    model: FakeModel = el_live["model"]
    scribe = FakeScribe()
    monkeypatch.setattr(elevenlabs, "scribe_connect", scribe.connect)
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    rt = store.runtime(call_id)
    with client.websocket_connect(f"/ws/calls/{call_id}") as ui_ws, client.websocket_connect(
        f"/twilio/media/{call_id}"
    ) as tw_ws:
        ui = Collector(ui_ws)
        _start(tw_ws, rt)
        twilio = Collector(tw_ws)
        model.wait_sent("conversation_initiation_client_data")
        model.emit(type="audio", audio_event={"audio_base_64": audio(200), "event_id": 1})
        twilio.wait_for(lambda m: m["event"] == "media", "agent talking")

        # Take over: the agent is cut off and its audio no longer reaches the call.
        assert client.post(f"/calls/{call_id}/mode", json={"mode": "direct"}).json() == {"mode": "direct"}
        ui.wait_for(lambda e: e["type"] == "mode" and e["data"]["mode"] == "direct", "mode event")
        twilio.wait_for(lambda m: m["event"] == "clear", "agent cut off")
        scribe.connected.wait(2)
        assert "speech-to-text/realtime" in scribe.url and "audio_format=ulaw_8000" in scribe.url
        assert scribe.headers["xi-api-key"] == "xi-test"
        media_before = len([m for m in twilio.messages if m["event"] == "media"])
        model.emit(type="audio", audio_event={"audio_base_64": audio(200), "event_id": 2})
        model.emit(type="agent_response", agent_response_event={"agent_response": "Are you there?", "response_id": "r9"})

        # The callee's audio goes to Scribe in 100 ms chunks, and its captions reach the UI.
        chunks_before = len(model.sent)
        for ts in range(5):
            tw_ws.send_json({"event": "media", "media": {"timestamp": str(ts * 20), "payload": audio(20)}})
        chunk = scribe.wait_sent("", what="audio chunk to scribe") if False else wait_until(
            lambda: next((m for m in scribe.sent if m.get("message_type") == "input_audio_chunk"), None),
            what="audio chunk to scribe",
        )
        assert chunk["sample_rate"] == 8000 and chunk["audio_base_64"] == audio(100)
        assert not any("user_audio_chunk" in m for m in model.sent[chunks_before:]), "agent hears nothing while paused"
        scribe.emit(message_type="partial_transcript", text="Is this about the")
        ui.wait_for(lambda e: e["type"] == "transcript" and e["data"]["text"] == "Is this about the", "partial caption")
        scribe.emit(message_type="committed_transcript", text="Is this about the cleaning?")
        wait_until(
            lambda: any(t.speaker == "callee" and t.final and t.text == "Is this about the cleaning?" for t in rt.call.transcript),
            what="final caption",
        )
        assert len([m for m in twilio.messages if m["event"] == "media"]) == media_before
        assert not any(t.text == "Are you there?" for t in rt.call.transcript)

        # A tool call from the paused agent is turned away.
        model.emit(
            type="client_tool_call",
            client_tool_call={"tool_name": "ask_user", "tool_call_id": "tc9", "parameters": {"question": "?", "options": []}},
        )
        assert json.loads(model.wait_sent("client_tool_result")["result"])["skipped"] is True
        assert rt.call.pending_question is None

        # Hand back: Scribe closes, the agent gets briefed and picks the call back up.
        client.post(f"/calls/{call_id}/mode", json={"mode": "agent"})
        brief = model.wait_sent("contextual_update")
        assert "Is this about the cleaning?" in brief["text"] and "handed it back" in brief["text"]
        assert "handed the call back" in model.wait_sent("user_message")["text"]
        tw_ws.send_json({"event": "media", "media": {"timestamp": "200", "payload": audio(20)}})
        wait_until(lambda: any(m.get("user_audio_chunk") == audio(20) for m in model.sent), what="agent hears again")
        tw_ws.send_json({"event": "stop"})
        wait_until(lambda: rt.call.state in ("completed", "failed"), what="ended")


def test_direct_calls_start_with_the_agent_paused(client, el_live, monkeypatch):
    model: FakeModel = el_live["model"]
    scribe = FakeScribe()
    monkeypatch.setattr(elevenlabs, "scribe_connect", scribe.connect)
    monkeypatch.setattr(bridge, "KICKOFF_AFTER_S", 0.1)
    call_id = client.post("/calls", json={**TASK, "mode": "direct", "goal": ""}).json()["call_id"]
    rt = store.runtime(call_id)
    with client.websocket_connect(f"/twilio/media/{call_id}") as tw_ws:
        _start(tw_ws, rt)
        model.wait_sent("conversation_initiation_client_data")
        assert scribe.connected.wait(2)
        import time as _time

        _time.sleep(0.4)
        assert not model.of_type("user_message"), "no greeting from the agent when the user is typing"
        tw_ws.send_json({"event": "stop"})
        wait_until(lambda: rt.call.state in ("completed", "failed"), what="ended")
    # Ending a typed call once it was answered is a normal finish, not a failure.
    assert rt.call.state == "completed"
    assert rt.call.outcome is None
