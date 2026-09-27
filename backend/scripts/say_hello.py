"""First milestone from the spec: dial a phone and play a <Say> message.

Needs only TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_NUMBER (no tunnel, no model).

    backend/.venv/Scripts/python backend/scripts/say_hello.py +12155550142
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from twilio.rest import Client  # noqa: E402
from twilio.twiml.voice_response import VoiceResponse  # noqa: E402

from app.config import settings  # noqa: E402
from app.guardrails import is_allowed, normalize_number  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    to = normalize_number(sys.argv[1])
    missing = [
        name
        for name, value in {
            "TWILIO_ACCOUNT_SID": settings.twilio_account_sid,
            "TWILIO_AUTH_TOKEN": settings.twilio_auth_token,
            "TWILIO_NUMBER": settings.twilio_number,
        }.items()
        if not value
    ]
    if missing:
        print(f"Missing in .env: {', '.join(missing)}")
        return 1
    if not is_allowed(to, settings.allowed_numbers):
        print(f"{to} isn't in ALLOWED_NUMBERS. Add it to .env first.")
        return 1

    twiml = VoiceResponse()
    twiml.say("Hello from CallProxy. If you can hear this, outbound calling works. Goodbye!", voice="Polly.Joanna")
    call = Client(settings.twilio_account_sid, settings.twilio_auth_token).calls.create(
        to=to, from_=settings.twilio_number, twiml=str(twiml)
    )
    print(f"Calling {to} ... call SID {call.sid}. Your phone should ring now.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
