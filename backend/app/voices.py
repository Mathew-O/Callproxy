"""The ElevenLabs voices people can pick: one reads what the user types, one is the agent.

With an API key the list comes from the account (so it includes previews and any cloned
voices). Without one, the UI still shows ElevenLabs' premade voices so the choice is
visible in practice calls.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from .config import Settings

log = logging.getLogger("callproxy.voices")

# ElevenLabs premade voices: available on every account.
PREMADE: list[dict[str, str]] = [
    {"voice_id": "SAz9YHcvj6GT2YYXdXww", "name": "River", "gender": "neutral", "accent": "American", "description": "Relaxed, neutral, informative"},
    {"voice_id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah", "gender": "female", "accent": "American", "description": "Mature, reassuring, confident"},
    {"voice_id": "cjVigY5qzO86Huf0OWal", "name": "Eric", "gender": "male", "accent": "American", "description": "Smooth, trustworthy"},
    {"voice_id": "FGY2WhTYpPnrIDTdsKH5", "name": "Laura", "gender": "female", "accent": "American", "description": "Enthusiastic, quirky"},
    {"voice_id": "TX3LPaxmHKxFdv7VOQHJ", "name": "Liam", "gender": "male", "accent": "American", "description": "Energetic, young"},
    {"voice_id": "XrExE9yKIg1WjnnlVkGX", "name": "Matilda", "gender": "female", "accent": "American", "description": "Knowledgeable, professional"},
    {"voice_id": "JBFqnCBsd6RMkjVDRZzb", "name": "George", "gender": "male", "accent": "British", "description": "Warm, captivating storyteller"},
    {"voice_id": "Xb7hH8MSUJpSbSDYk0k2", "name": "Alice", "gender": "female", "accent": "British", "description": "Clear, engaging educator"},
    {"voice_id": "IKne3meq5aSn9XLyUdCD", "name": "Charlie", "gender": "male", "accent": "Australian", "description": "Deep, confident, energetic"},
    {"voice_id": "pFZP5JQG7iQjIQuC4Bku", "name": "Lily", "gender": "female", "accent": "British", "description": "Velvety actress"},
    {"voice_id": "nPczCjzI2devNBz1zQrb", "name": "Brian", "gender": "male", "accent": "American", "description": "Deep, resonant, comforting"},
    {"voice_id": "cgSgspJ2msm6clMCkdW9", "name": "Jessica", "gender": "female", "accent": "American", "description": "Playful, bright, warm"},
]
# The simulated receptionist's voice in practice calls.
RECEPTIONIST_VOICE_ID = "FGY2WhTYpPnrIDTdsKH5"
CACHE_SECONDS = 600

_cache: tuple[float, list[dict[str, Any]]] | None = None


def premade() -> list[dict[str, Any]]:
    return [dict(v, preview_url=None, source="premade") for v in PREMADE]


def voice_name(voice_id: str | None, known: list[dict[str, Any]] | None = None) -> str:
    for v in (known or []) + PREMADE:
        if v["voice_id"] == voice_id:
            return str(v["name"])
    return "Custom voice" if voice_id else "Default voice"


def cached() -> list[dict[str, Any]]:
    return _cache[1] if _cache else []


async def list_voices(settings: Settings, fetch: Any = None) -> tuple[list[dict[str, Any]], bool]:
    """(voices, from_account). Falls back to the premade list without a key or on errors."""
    global _cache
    if not settings.elevenlabs_api_key or fetch is None:
        return premade(), False
    if _cache and time.monotonic() - _cache[0] < CACHE_SECONDS:
        return _cache[1], True
    try:
        raw = await fetch()
    except Exception as exc:  # noqa: BLE001 - a voice list isn't worth failing a page over
        log.warning("couldn't list ElevenLabs voices: %s", exc)
        return premade(), False
    voices = []
    for v in raw:
        labels = v.get("labels") or {}
        voices.append(
            {
                "voice_id": v["voice_id"],
                "name": v.get("name") or "Unnamed",
                "gender": labels.get("gender", ""),
                "accent": (labels.get("accent") or "").title(),
                "description": v.get("description") or labels.get("descriptive") or labels.get("use_case") or "",
                "preview_url": v.get("preview_url"),
                "source": v.get("category") or "account",
            }
        )
    # Premade voices first, in our curated order, then the rest of the account's library.
    order = {p["voice_id"]: i for i, p in enumerate(PREMADE)}
    voices.sort(key=lambda v: (order.get(v["voice_id"], len(order)), v["name"]))
    _cache = (time.monotonic(), voices)
    return voices, True
