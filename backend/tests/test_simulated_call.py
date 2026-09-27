from app.calls import store
from app.config import settings

from .conftest import Collector, wait_until

TASK = {
    "to_number": "215-555-0142",
    "callee_name": "Dr. Rivera's office",
    "user_name": "Sam Lee",
    "goal": "Book a teeth cleaning",
    "facts": {"Date of birth": "March 14, 2004", "Card number": "4111 1111 1111 1111"},
    "constraints": ["Tuesday or Thursday afternoons"],
    "simulate": True,
}


def _states(events):
    return [e["data"]["state"] for e in events if e["type"] == "status"]


def test_simulated_call_runs_the_demo_script(client):
    res = client.post("/calls", json=TASK)
    assert res.status_code == 201
    body = res.json()
    assert body["withheld_facts"] == ["Card number"]
    call_id = body["call_id"]

    with client.websocket_connect(f"/ws/calls/{call_id}") as ws:
        events = Collector(ws)
        assert events.wait_for(lambda e: e["type"] == "snapshot", "snapshot")["data"]["id"] == call_id
        question = events.wait_for(lambda e: e["type"] == "ask_user", "decision card")["data"]
        assert question["question"] == "Which appointment works better?"
        assert len(question["options"]) == 2
        assert client.get(f"/calls/{call_id}").json()["state"] == "waiting_on_user"

        choice = question["options"][0]
        assert client.post(
            f"/calls/{call_id}/reply", json={"question_id": question["question_id"], "answer": choice}
        ).json() == {"ok": True}
        # A second answer to the same question is refused.
        assert (
            client.post(
                f"/calls/{call_id}/reply", json={"question_id": question["question_id"], "answer": choice}
            ).status_code
            == 409
        )

        events.wait_for(
            lambda e: e["type"] == "snapshot" and e["data"]["state"] == "completed", "completed", timeout=10
        )

    states = _states(events.messages)
    assert states[:3] == ["ringing", "in_progress", "waiting_on_user"]
    assert states[-2:] == ["wrapping_up", "completed"]

    call = client.get(f"/calls/{call_id}").json()
    assert call["outcome"]["status"] == "success"
    assert call["outcome"]["details"]["time"] == "15:00"
    assert call["outcome"]["details"]["confirmation_number"] == "RC-4821"
    speakers = [t["speaker"] for t in call["transcript"]]
    assert speakers[0] == "callee" and "agent" in speakers and "user" in speakers
    assert call["transcript"][1]["text"].startswith("Hi, I'm an AI assistant calling on behalf of Sam Lee.")
    assert all(t["final"] for t in call["transcript"])
    # Partial lines stream before the final one.
    assert any(e["type"] == "transcript" and not e["data"]["final"] for e in events.messages)


def test_missing_fact_becomes_an_open_question(client):
    res = client.post("/calls", json={**TASK, "facts": {}})
    call_id = res.json()["call_id"]
    with client.websocket_connect(f"/ws/calls/{call_id}") as ws:
        events = Collector(ws)
        q = events.wait_for(lambda e: e["type"] == "ask_user", "question")["data"]
        assert "date of birth" in q["question"]
        assert q["options"] == []
        client.post(f"/calls/{call_id}/reply", json={"question_id": q["question_id"], "answer": "May 2, 2003"})
        events.wait_for(lambda e: e["type"] == "question_closed", "question closed")
        events.wait_for(
            lambda e: e["type"] == "ask_user" and e["data"]["question_id"] != q["question_id"], "second question"
        )
    call = store.get(call_id)
    assert any(t.speaker == "user" and t.text == "May 2, 2003" for t in call.transcript)


def test_unanswered_question_times_out_and_agent_offers_callback(client, monkeypatch):
    monkeypatch.setattr(settings, "ask_user_timeout_s", 0.3)
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    with client.websocket_connect(f"/ws/calls/{call_id}") as ws:
        events = Collector(ws)
        events.wait_for(lambda e: e["type"] == "ask_user" and e["data"]["timed_out"], "timeout")
        final = events.wait_for(
            lambda e: e["type"] == "snapshot" and e["data"]["state"] == "completed", "completed", timeout=10
        )
    assert final["data"]["outcome"]["status"] == "partial"


def test_user_hangup_fails_the_call_with_a_reason(client):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    wait_until(lambda: store.get(call_id).state == "waiting_on_user", what="question")
    assert client.post(f"/calls/{call_id}/hangup").json() == {"ok": True}
    call = client.get(f"/calls/{call_id}").json()
    assert call["state"] == "failed"
    assert call["detail"] == "You ended the call before the task was finished."
    assert call["pending_question"] is None


def test_number_ending_in_0000_simulates_no_answer(client):
    call_id = client.post("/calls", json={**TASK, "to_number": "+12155550000"}).json()["call_id"]
    wait_until(lambda: store.get(call_id).state == "no_answer", what="no answer")
    assert store.get(call_id).detail


def test_typed_line_is_voiced_with_status_updates(client):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    assert client.post(f"/calls/{call_id}/say", json={"text": "Hello"}).status_code == 409  # not connected yet
    wait_until(lambda: store.get(call_id).state == "waiting_on_user", what="question")
    with client.websocket_connect(f"/ws/calls/{call_id}") as ws:
        events = Collector(ws)
        line_id = client.post(f"/calls/{call_id}/say", json={"text": "Could you repeat that?"}).json()["line_id"]
        statuses = lambda: [e["data"]["status"] for e in events.messages if e["type"] == "transcript" and e["data"]["id"] == line_id]
        wait_until(lambda: "spoken" in statuses(), what="line spoken")
        assert statuses()[:2] == ["queued", "speaking"]
        speech = events.wait_for(lambda e: e["type"] == "sim_speech" and e["data"]["id"] == line_id, "voice event")
        assert speech["data"]["speaker"] == "user" and speech["data"]["voice_id"]
        # Maria repeats herself when asked.
        events.wait_for(
            lambda e: e["type"] == "transcript" and e["data"]["speaker"] == "callee" and e["data"]["final"]
            and e["data"]["text"].startswith("Sure. Thanks, I found you."),
            "repeat",
        )
    line = next(t for t in store.get(call_id).transcript if t.id == line_id)
    assert (line.via, line.voice) == ("typed", "River")


def test_typing_the_whole_call_yourself(client):
    call_id = client.post("/calls", json={**TASK, "mode": "direct", "goal": ""}).json()["call_id"]
    wait_until(lambda: any(t.speaker == "callee" and t.final for t in store.get(call_id).transcript), what="hello")
    call = store.get(call_id)
    assert call.mode == "direct"

    def say_and_wait(text: str, expect: str) -> None:
        client.post(f"/calls/{call_id}/say", json={"text": text})
        wait_until(
            lambda: any(t.speaker == "callee" and t.final and expect in t.text for t in call.transcript),
            what=f"reply containing {expect!r}",
        )

    say_and_wait("Hi, this is Sam. I'm typing and a voice reads my words.", "How can I help you today?")
    say_and_wait("I'd like to book a teeth cleaning.", "date of birth")
    say_and_wait("It's March 14, 2004.", "two openings")
    say_and_wait("Friday works.", "You're all set for Friday")
    wait_until(lambda: call.outcome is not None, what="booking recorded")
    assert call.outcome.details["time"] == "10:00"
    say_and_wait("Great, thanks.", "anything else")
    say_and_wait("No, that's all. Bye!", "Have a wonderful day")
    wait_until(lambda: call.state == "completed", what="completed")
    assert not any(t.speaker == "agent" for t in call.transcript), "the agent never spoke"


def test_taking_over_mid_question_then_handing_back(client):
    call_id = client.post("/calls", json=TASK).json()["call_id"]
    wait_until(lambda: store.get(call_id).state == "waiting_on_user", what="question")
    call = store.get(call_id)
    assert client.post(f"/calls/{call_id}/mode", json={"mode": "direct"}).json() == {"mode": "direct"}
    assert call.pending_question is None and call.state == "in_progress"
    client.post(f"/calls/{call_id}/say", json={"text": "Thursday please."})
    wait_until(lambda: call.outcome is not None, what="booked by typing")
    assert call.outcome.details["time"] == "15:00"
    # Hand back: the agent finishes the call.
    client.post(f"/calls/{call_id}/mode", json={"mode": "agent"})
    wait_until(lambda: call.state == "completed", what="agent wraps up", timeout=10)
    assert any(t.speaker == "agent" and "Just to confirm" in t.text for t in call.transcript)


def test_agent_mode_needs_a_goal_but_typing_does_not(client):
    assert client.post("/calls", json={**TASK, "goal": ""}).status_code == 422
    assert client.post("/calls", json={**TASK, "mode": "direct", "goal": ""}).status_code == 201


def test_voices_without_a_key_are_the_premade_list(client):
    body = client.get("/voices").json()
    assert body["from_account"] is False
    names = [v["name"] for v in body["voices"]]
    assert "River" in names and "Sarah" in names
    assert client.post("/tts", json={"text": "hi", "voice_id": "x"}).status_code == 503
    cfg = client.get("/config").json()
    assert cfg["tts"] is False and cfg["default_my_voice_id"]


def test_voices_and_tts_with_a_key(client, monkeypatch):
    from app import main, voices

    monkeypatch.setattr(settings, "elevenlabs_api_key", "xi")
    monkeypatch.setattr(voices, "_cache", None)

    async def fake_voices():
        return [
            {"voice_id": "zzz", "name": "My Clone", "labels": {"accent": "american"}, "category": "cloned"},
            {"voice_id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah", "preview_url": "https://x/p.mp3", "labels": {}},
        ]

    async def fake_synth(text, voice_id=None, output_format=""):
        return b"ID3mp3"

    monkeypatch.setattr(main.elevenlabs, "voices", fake_voices)
    monkeypatch.setattr(main.elevenlabs, "synthesize", fake_synth)
    body = client.get("/voices").json()
    assert body["from_account"] is True
    assert [v["name"] for v in body["voices"]] == ["Sarah", "My Clone"]  # premade first
    assert body["voices"][0]["preview_url"] == "https://x/p.mp3"
    res = client.post("/tts", json={"text": "Hello there", "voice_id": "zzz"})
    assert res.status_code == 200 and res.headers["content-type"] == "audio/mpeg" and res.content == b"ID3mp3"


def test_live_call_requires_configuration_and_allowlist(client, live_settings, monkeypatch):
    live = {**TASK, "simulate": False, "to_number": "+12155550199"}
    res = client.post("/calls", json=live)
    assert res.status_code == 403
    assert "allowlist" in res.json()["detail"]

    monkeypatch.setattr(settings, "openai_api_key", "")
    res = client.post("/calls", json={**live, "to_number": "+12155550142"})
    assert res.status_code == 400
    # With no model key at all, CallProxy asks for the default provider's.
    assert "ELEVENLABS_API_KEY" in res.json()["detail"]


def test_config_masks_allowed_numbers(client, live_settings):
    cfg = client.get("/config").json()
    assert cfg["live_calls"] is True
    assert cfg["allowed_numbers"] == ["•••• 0142"]


def test_unknown_call_is_404(client):
    assert client.get("/calls/nope").status_code == 404
    with client.websocket_connect("/ws/calls/nope") as ws:
        assert ws.receive_json()["type"] == "error"


def test_one_click_demo(client, live_settings, monkeypatch):
    from app import main

    placed = []

    async def place_call(call_id, to):
        placed.append(to)
        return "CA1"

    monkeypatch.setattr(main.telephony, "place_call", place_call)
    monkeypatch.setattr(settings, "voice_provider_setting", "openai")
    practice = client.post("/demo/call", json={"live": False}).json()["call_id"]
    call = store.get(practice)
    assert call.simulated and call.mode == "direct" and call.task.user_name == "Jordan Lee"
    assert client.get("/config").json()["demo_number"] == "•••• 0142"

    live = client.post("/demo/call", json={"live": True}).json()["call_id"]
    assert not store.get(live).simulated
    assert placed == ["+12155550142"]  # the first allowlisted number

    monkeypatch.setattr(settings, "allowed_numbers", [])
    assert client.post("/demo/call", json={"live": True}).status_code == 400
