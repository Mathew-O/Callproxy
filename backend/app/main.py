"""CallProxy API: REST for the UI, webhooks for Twilio, and the two websockets."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from twilio.base.exceptions import TwilioRestException

from .agent import build_instructions
from .bridge import TwilioBridge
from .calls import CallRuntime, store
from .config import ROOT, settings
from .guardrails import is_allowed, normalize_number, split_facts
from .elevenlabs import ElevenLabsBridge, ElevenLabsClient, ElevenLabsError
from .models import (
    TERMINAL_STATES,
    CallTask,
    CreateCallRequest,
    DemoRequest,
    ModeRequest,
    ReplyRequest,
    SayRequest,
    TtsRequest,
)
from .realtime import RealtimeBridge
from .simulator import Simulator
from .telephony import Telephony, hangup_twiml, signature_ok, stream_twiml
from .voices import cached as cached_voices
from .voices import list_voices, voice_name

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("callproxy")

app = FastAPI(title="CallProxy")
telephony = Telephony(settings)
elevenlabs = ElevenLabsClient(settings)

ACTIVE_FOR_SPEECH = {"in_progress", "waiting_on_user", "wrapping_up"}


def _runtime(call_id: str) -> CallRuntime:
    rt = store.runtime(call_id)
    if not rt:
        raise HTTPException(404, "No call with that id.")
    return rt


def _mask(number: str) -> str:
    n = normalize_number(number)
    return f"•••• {n[-4:]}" if len(n) >= 4 else n


# ---- UI endpoints ----------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/config")
async def get_config() -> dict[str, Any]:
    return {
        "live_calls": settings.live_calls_configured,
        "voice_provider": settings.voice_provider,
        "missing_settings": settings.missing_live_settings,
        "allowed_numbers": [_mask(n) for n in settings.allowed_numbers],
        "max_call_seconds": settings.max_call_seconds,
        "ask_user_timeout_s": settings.ask_user_timeout_s,
        # ElevenLabs text to speech: typed lines on live calls, and voices in the browser.
        "tts": bool(settings.elevenlabs_api_key),
        "default_agent_voice_id": settings.elevenlabs_voice_id,
        "default_my_voice_id": settings.elevenlabs_my_voice_id,
        "demo_number": _mask(settings.demo_phone) if settings.demo_phone else None,
    }


@app.get("/voices")
async def get_voices() -> dict[str, Any]:
    voices, from_account = await list_voices(settings, elevenlabs.voices)
    return {"voices": voices, "from_account": from_account}


@app.post("/tts")
async def tts(body: TtsRequest) -> Response:
    """An mp3 of the text in an ElevenLabs voice, for previews and practice-call audio."""
    if not settings.elevenlabs_api_key:
        raise HTTPException(503, "Add ELEVENLABS_API_KEY to hear ElevenLabs voices.")
    try:
        audio = await elevenlabs.synthesize(body.text, body.voice_id, "mp3_44100_64")
    except ElevenLabsError as exc:
        raise HTTPException(502, str(exc)) from exc
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})


@app.post("/calls", status_code=201)
async def create_call(req: CreateCallRequest) -> dict[str, Any]:
    task = CallTask(**req.model_dump(exclude={"simulate"}))
    task.to_number = normalize_number(task.to_number)
    if len(task.to_number) < 8:
        raise HTTPException(422, "That phone number doesn't look complete.")
    safe_facts, withheld = split_facts(task.facts)

    if not req.simulate:
        if not settings.live_calls_configured:
            missing = ", ".join(settings.missing_live_settings)
            raise HTTPException(400, f"Live calling isn't set up yet (missing {missing}). Try a simulated call.")
        if not is_allowed(task.to_number, settings.allowed_numbers):
            raise HTTPException(
                403,
                f"{task.to_number} isn't on the allowlist. During the hackathon CallProxy only dials "
                "numbers listed in ALLOWED_NUMBERS.",
            )

    model_url: str | None = None
    if not req.simulate and settings.voice_provider == "elevenlabs":
        # Sync the agent and sign the conversation URL before dialing, so a bad key shows
        # up here instead of as dead air after someone picks up.
        try:
            model_url = await elevenlabs.signed_url(await elevenlabs.ensure_agent())
        except ElevenLabsError as exc:
            raise HTTPException(502, str(exc)) from exc

    rt = store.create(task, simulated=req.simulate, withheld=withheld)
    call = rt.call
    call.voice_provider = "simulator" if req.simulate else settings.voice_provider
    rt.instructions = build_instructions(task, safe_facts)
    rt.model_url = model_url

    if req.simulate:
        Simulator(rt, settings, safe_facts).start()
    else:
        try:
            call.twilio_sid = await telephony.place_call(call.id, task.to_number)
        except TwilioRestException as exc:
            log.warning("twilio refused call: %s", exc)
            rt.finish(f"Twilio couldn't place the call: {exc.msg}")
            raise HTTPException(502, f"Twilio couldn't place the call: {exc.msg}") from exc
        sid = call.twilio_sid

        async def hang_up() -> None:
            await telephony.hangup(sid, ringing=call.state in ("dialing", "ringing"))

        rt.hangup_fn = hang_up
    log.info("call %s created (%s) to %s", call.id, "simulated" if req.simulate else "live", task.to_number)
    return {"call_id": call.id, "withheld_facts": withheld}


# The stage demo in one click: Jordan (a Deaf student) booking a dentist appointment by
# typing. Live dials the judge's phone (DEMO_NUMBER or the first allowlisted number).
DEMO_TASK = {
    "callee_name": "Dr. Rivera's office",
    "user_name": "Jordan Lee",
    "goal": "Book a teeth cleaning appointment.",
    "facts": {
        "Patient name": "Jordan Lee",
        "Date of birth": "March 14, 2005",
        "Insurance": "Delta Dental PPO",
        "Best contact": "Text (215) 555-0142. I'm Deaf, so please no voice calls.",
    },
    "constraints": ["I'm free Tuesday and Thursday afternoons."],
    "mode": "direct",
}


@app.post("/demo/call", status_code=201)
async def demo_call(body: DemoRequest) -> dict[str, Any]:
    if body.live and not settings.demo_phone:
        raise HTTPException(400, "Set DEMO_NUMBER (or ALLOWED_NUMBERS) to the judge's phone for the live demo.")
    number = settings.demo_phone if body.live else "+12155550142"
    return await create_call(CreateCallRequest(**DEMO_TASK, to_number=number, simulate=not body.live))


@app.get("/calls/{call_id}")
async def get_call(call_id: str) -> dict[str, Any]:
    rt = _runtime(call_id)
    return store.public_view(rt.call)


@app.post("/calls/{call_id}/reply")
async def reply(call_id: str, body: ReplyRequest) -> dict[str, bool]:
    rt = _runtime(call_id)
    if not await rt.reply(body.question_id, body.answer):
        raise HTTPException(409, "That question is no longer open.")
    return {"ok": True}


@app.post("/calls/{call_id}/say")
async def say(call_id: str, body: SayRequest) -> dict[str, str]:
    """Queue a line the user typed; it's read out in their voice and its status streams back."""
    rt = _runtime(call_id)
    if rt.call.state not in ACTIVE_FOR_SPEECH or not rt.voice:
        raise HTTPException(409, "The call isn't connected right now.")
    voice_id = body.voice_id or rt.call.task.my_voice_id or settings.elevenlabs_my_voice_id
    line_id = await rt.say(body.text, voice_id, voice_name(voice_id, cached_voices()))
    return {"line_id": line_id}


@app.post("/calls/{call_id}/mode")
async def set_mode(call_id: str, body: ModeRequest) -> dict[str, str]:
    """Take the call over and type (direct), or hand it back to the agent."""
    rt = _runtime(call_id)
    if rt.call.state in TERMINAL_STATES:
        raise HTTPException(409, "The call has ended.")
    await rt.switch_mode(body.mode)
    return {"mode": rt.call.mode}


@app.post("/calls/{call_id}/hangup")
async def hangup(call_id: str) -> dict[str, bool]:
    rt = _runtime(call_id)
    await rt.hang_up("user")
    rt.finish()
    return {"ok": True}


@app.websocket("/ws/calls/{call_id}")
async def call_events(ws: WebSocket, call_id: str) -> None:
    await ws.accept()
    rt = store.runtime(call_id)
    if not rt:
        await ws.send_json({"type": "error", "data": {"message": "No call with that id."}})
        await ws.close(code=4404)
        return
    queue = store.subscribe(call_id)
    try:
        await ws.send_json({"type": "snapshot", "data": store.public_view(rt.call)})

        async def forward() -> None:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    event = {"type": "ping", "data": {}}  # keeps tunnels from closing an idle socket
                await ws.send_json(event)

        async def drain() -> None:
            # Ends when the browser goes away.
            with contextlib.suppress(WebSocketDisconnect):
                while True:
                    await ws.receive_text()

        tasks = [asyncio.create_task(forward()), asyncio.create_task(drain())]
        _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        store.unsubscribe(call_id, queue)


# ---- Twilio webhooks ---------------------------------------------------------


async def _twilio_params(request: Request) -> dict[str, str]:
    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    if settings.validate_twilio_signatures and settings.twilio_auth_token:
        url = f"{settings.public_url}{request.url.path}"
        if request.url.query:
            url += f"?{request.url.query}"
        if not signature_ok(settings.twilio_auth_token, url, params, request.headers.get("X-Twilio-Signature")):
            log.warning("bad Twilio signature for %s (is PUBLIC_URL the tunnel Twilio is calling?)", url)
            raise HTTPException(403, "Invalid Twilio signature")
    return params


@app.post("/twilio/voice/{call_id}")
async def twilio_voice(call_id: str, request: Request) -> Response:
    await _twilio_params(request)
    rt = store.runtime(call_id)
    if not rt or rt.call.state in TERMINAL_STATES:
        return Response(hangup_twiml(), media_type="application/xml")
    twiml = stream_twiml(f"{settings.public_ws_url}/twilio/media/{call_id}", rt.stream_token)
    return Response(twiml, media_type="application/xml")


@app.post("/twilio/status/{call_id}")
async def twilio_status(call_id: str, request: Request) -> Response:
    params = await _twilio_params(request)
    rt = store.runtime(call_id)
    if not rt:
        return Response(status_code=204)
    status = params.get("CallStatus", "")
    log.info("twilio status for %s: %s", call_id, status)
    call = rt.call
    if status == "ringing" and call.state == "dialing":
        store.set_state(call, "ringing")
    elif status == "in-progress":
        rt.mark_answered()
    elif status == "busy":
        rt.no_answer("The line was busy.")
    elif status == "no-answer":
        rt.no_answer(f"No one picked up after {settings.ring_timeout_s} seconds.")
    elif status == "failed":
        rt.finish("The phone network couldn't connect the call.")
    elif status == "canceled":
        rt.finish(None if rt.hangup_by else "The call was canceled before anyone answered.")
    elif status == "completed":
        if call.answered_at is None and call.state in ("dialing", "ringing") and not rt.hangup_by:
            rt.no_answer("No one picked up.")
        else:
            rt.finish()
    return Response(status_code=204)


@app.websocket("/twilio/media/{call_id}")
async def twilio_media(ws: WebSocket, call_id: str) -> None:
    await ws.accept()
    rt = store.runtime(call_id)
    if not rt or rt.call.state in TERMINAL_STATES:
        await ws.close(code=1008)
        return
    # Typed lines are read in an ElevenLabs voice whenever there's a key, whatever the agent runs on.
    phone_tts = elevenlabs.phone_tts if settings.elevenlabs_api_key else None
    bridge: TwilioBridge
    if rt.call.voice_provider == "elevenlabs" and rt.model_url:
        bridge = ElevenLabsBridge(
            ws, rt, settings, rt.instructions, tts=phone_tts, client=elevenlabs, signed_url=rt.model_url
        )
    else:
        bridge = RealtimeBridge(ws, rt, settings, rt.instructions, tts=phone_tts)
    with contextlib.suppress(WebSocketDisconnect):
        await bridge.run()


# ---- Web app -------------------------------------------------------------------

@app.middleware("http")
async def revalidate_html(request: Request, call_next: Any) -> Any:
    # Built assets have hashed names; the page itself must never go stale after a rebuild.
    response = await call_next(request)
    if response.headers.get("content-type", "").startswith("text/html"):
        response.headers["Cache-Control"] = "no-cache"
    return response


DIST = ROOT / "web" / "dist"
if (DIST / "index.html").exists():
    app.mount("/", StaticFiles(directory=Path(DIST), html=True), name="web")
