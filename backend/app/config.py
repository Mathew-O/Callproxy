"""Settings loaded from the repo-root .env (or the process environment)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    raw = os.getenv(name)
    return float(raw) if raw else default


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    return int(raw) if raw else default


def _list(name: str) -> list[str]:
    raw = os.getenv(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass
class Settings:
    # Twilio
    twilio_account_sid: str = field(default_factory=lambda: os.getenv("TWILIO_ACCOUNT_SID", ""))
    twilio_auth_token: str = field(default_factory=lambda: os.getenv("TWILIO_AUTH_TOKEN", ""))
    twilio_number: str = field(default_factory=lambda: os.getenv("TWILIO_NUMBER", ""))
    validate_twilio_signatures: bool = field(
        default_factory=lambda: _bool("TWILIO_VALIDATE_SIGNATURES", True)
    )
    public_url: str = field(default_factory=lambda: os.getenv("PUBLIC_URL", "").rstrip("/"))
    allowed_numbers: list[str] = field(default_factory=lambda: _list("ALLOWED_NUMBERS"))
    ring_timeout_s: int = field(default_factory=lambda: _int("RING_TIMEOUT_SECONDS", 30))
    # The judge's phone for the one-click live demo. Defaults to the first allowlisted number.
    demo_number: str = field(default_factory=lambda: os.getenv("DEMO_NUMBER", ""))

    # Which voice model runs live calls: "elevenlabs", "openai", or "auto" (ElevenLabs when
    # its key is set, otherwise OpenAI).
    voice_provider_setting: str = field(default_factory=lambda: os.getenv("VOICE_PROVIDER", "auto").strip().lower())

    # Voice model: ElevenLabs Agents
    elevenlabs_api_key: str = field(default_factory=lambda: os.getenv("ELEVENLABS_API_KEY", ""))
    elevenlabs_base_url: str = field(
        default_factory=lambda: os.getenv("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io").rstrip("/")
    )
    # Optional: pin an agent you made yourself. Otherwise CallProxy creates and syncs one.
    elevenlabs_agent_id: str = field(default_factory=lambda: os.getenv("ELEVENLABS_AGENT_ID", ""))
    # "Sarah": a premade voice every account has. Browse others at elevenlabs.io/app/voice-library.
    elevenlabs_voice_id: str = field(
        default_factory=lambda: os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")
    )
    # The default voice that reads what the user types ("River": calm, gender-neutral).
    elevenlabs_my_voice_id: str = field(
        default_factory=lambda: os.getenv("ELEVENLABS_MY_VOICE_ID", "SAz9YHcvj6GT2YYXdXww")
    )
    elevenlabs_llm: str = field(default_factory=lambda: os.getenv("ELEVENLABS_LLM", "gemini-2.5-flash"))
    elevenlabs_tts_model: str = field(default_factory=lambda: os.getenv("ELEVENLABS_TTS_MODEL", "eleven_flash_v2"))
    elevenlabs_turn_eagerness: str = field(
        default_factory=lambda: os.getenv("ELEVENLABS_TURN_EAGERNESS", "normal")
    )

    # Voice model: OpenAI Realtime
    openai_api_key: str = field(default_factory=lambda: os.getenv("OPENAI_API_KEY", ""))
    realtime_model: str = field(default_factory=lambda: os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime"))
    realtime_url: str = field(
        default_factory=lambda: os.getenv("OPENAI_REALTIME_URL", "wss://api.openai.com/v1/realtime")
    )
    voice: str = field(default_factory=lambda: os.getenv("OPENAI_VOICE", "marin"))
    transcribe_model: str = field(
        default_factory=lambda: os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
    )
    # Turn detection. A judge on speakerphone in a loud room wants a higher threshold
    # and NOISE_REDUCTION=far_field.
    vad_threshold: float = field(default_factory=lambda: _float("VAD_THRESHOLD", 0.6))
    vad_silence_ms: int = field(default_factory=lambda: _int("VAD_SILENCE_MS", 500))
    vad_prefix_ms: int = field(default_factory=lambda: _int("VAD_PREFIX_MS", 300))
    noise_reduction: str = field(default_factory=lambda: os.getenv("NOISE_REDUCTION", "near_field"))

    # Call rules
    max_call_seconds: int = field(default_factory=lambda: _int("MAX_CALL_SECONDS", 300))
    ask_user_timeout_s: float = field(default_factory=lambda: _float("ASK_USER_TIMEOUT_SECONDS", 30))

    # Simulator: lets the whole UI run without Twilio or a model key.
    simulator_speed: float = field(default_factory=lambda: _float("SIMULATOR_SPEED", 1.0))

    @property
    def voice_provider(self) -> str:
        if self.voice_provider_setting in ("elevenlabs", "openai"):
            return self.voice_provider_setting
        return "elevenlabs" if self.elevenlabs_api_key or not self.openai_api_key else "openai"

    @property
    def live_calls_configured(self) -> bool:
        return not self.missing_live_settings

    @property
    def missing_live_settings(self) -> list[str]:
        required = {
            "TWILIO_ACCOUNT_SID": self.twilio_account_sid,
            "TWILIO_AUTH_TOKEN": self.twilio_auth_token,
            "TWILIO_NUMBER": self.twilio_number,
            "PUBLIC_URL": self.public_url,
        }
        if self.voice_provider == "elevenlabs":
            required["ELEVENLABS_API_KEY"] = self.elevenlabs_api_key
        else:
            required["OPENAI_API_KEY"] = self.openai_api_key
        return [name for name, value in required.items() if not value]

    @property
    def demo_phone(self) -> str:
        return self.demo_number or (self.allowed_numbers[0] if self.allowed_numbers else "")

    @property
    def public_ws_url(self) -> str:
        if self.public_url.startswith("https://"):
            return "wss://" + self.public_url[len("https://") :]
        if self.public_url.startswith("http://"):
            return "ws://" + self.public_url[len("http://") :]
        return self.public_url


settings = Settings()
