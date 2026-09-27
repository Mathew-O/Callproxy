from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def hermetic_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ignore whatever is in the developer's .env."""
    for name, value in {
        "twilio_account_sid": "",
        "twilio_auth_token": "",
        "twilio_number": "",
        "public_url": "",
        "openai_api_key": "",
        "elevenlabs_api_key": "",
        "elevenlabs_agent_id": "",
        "voice_provider_setting": "auto",
        "allowed_numbers": [],
        "simulator_speed": 50.0,
        "ask_user_timeout_s": 30.0,
        "max_call_seconds": 300,
        "validate_twilio_signatures": True,
    }.items():
        monkeypatch.setattr(settings, name, value)


@pytest.fixture
def client() -> Any:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def live_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "twilio_account_sid", "AC" + "0" * 32)
    monkeypatch.setattr(settings, "twilio_auth_token", "test-auth-token")
    monkeypatch.setattr(settings, "twilio_number", "+15550001111")
    monkeypatch.setattr(settings, "public_url", "https://callproxy.example.test")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(settings, "allowed_numbers", ["+1 (215) 555-0142"])


def wait_until(predicate: Callable[[], Any], timeout: float = 5.0, what: str = "condition") -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.01)
    raise AssertionError(f"timed out waiting for {what}")


class Collector:
    """Reads a TestClient websocket on a background thread so tests can poll it."""

    def __init__(self, ws: Any):
        self.ws = ws
        self.messages: list[dict[str, Any]] = []
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        try:
            while True:
                self.messages.append(self.ws.receive_json())
        except Exception:  # noqa: BLE001 - socket closed
            pass

    def find(self, predicate: Callable[[dict[str, Any]], bool]) -> list[dict[str, Any]]:
        return [m for m in list(self.messages) if predicate(m)]

    def wait_for(self, predicate: Callable[[dict[str, Any]], bool], what: str, timeout: float = 5.0) -> dict[str, Any]:
        return wait_until(lambda: next(iter(self.find(predicate)), None), timeout, what)
