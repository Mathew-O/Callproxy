"""Twilio Voice: place and end calls, build TwiML, and check webhook signatures."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Mapping

from twilio.request_validator import RequestValidator
from twilio.rest import Client
from twilio.twiml.voice_response import Connect, VoiceResponse

from .config import Settings

log = logging.getLogger("callproxy.twilio")


class Telephony:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client: Client | None = None

    @property
    def client(self) -> Client:
        if self._client is None:
            self._client = Client(self.settings.twilio_account_sid, self.settings.twilio_auth_token)
        return self._client

    async def place_call(self, call_id: str, to_number: str) -> str:
        s = self.settings
        base = s.public_url

        def create() -> Any:
            return self.client.calls.create(
                to=to_number,
                from_=s.twilio_number,
                url=f"{base}/twilio/voice/{call_id}",
                method="POST",
                status_callback=f"{base}/twilio/status/{call_id}",
                status_callback_method="POST",
                status_callback_event=["initiated", "ringing", "answered", "completed"],
                timeout=s.ring_timeout_s,
                # Hard cap enforced by Twilio itself, on top of our own timer.
                time_limit=s.max_call_seconds + 15,
            )

        call = await asyncio.to_thread(create)
        return call.sid

    async def hangup(self, sid: str, *, ringing: bool = False) -> None:
        # Twilio ends ringing calls with "canceled" and live ones with "completed".
        first, second = ("canceled", "completed") if ringing else ("completed", "canceled")

        def update(status: str) -> None:
            self.client.calls(sid).update(status=status)

        try:
            await asyncio.to_thread(update, first)
        except Exception:  # noqa: BLE001
            log.info("hangup with %s failed for %s, retrying with %s", first, sid, second)
            await asyncio.to_thread(update, second)


def stream_twiml(ws_url: str, token: str) -> str:
    response = VoiceResponse()
    connect = Connect()
    stream = connect.stream(url=ws_url)
    # Stream URLs can't carry query strings, so the per-call token rides as a parameter.
    stream.parameter(name="token", value=token)
    response.append(connect)
    return str(response)


def hangup_twiml() -> str:
    response = VoiceResponse()
    response.hangup()
    return str(response)


def signature_ok(auth_token: str, url: str, params: Mapping[str, str], signature: str | None) -> bool:
    if not signature:
        return False
    return RequestValidator(auth_token).validate(url, dict(params), signature)
