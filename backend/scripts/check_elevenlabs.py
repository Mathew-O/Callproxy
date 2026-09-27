"""Hello-world check for ElevenLabs: creates (or updates) the CallProxy agent and its
tools, then runs two text-only turns of the demo to confirm the agent says it's an AI
and hands a two-slot choice to the user through ask_user. No phone needed.

    backend/.venv/Scripts/python backend/scripts/check_elevenlabs.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from websockets.asyncio.client import connect  # noqa: E402

from app.agent import build_instructions  # noqa: E402
from app.config import settings  # noqa: E402
from app.elevenlabs import ElevenLabsClient, ElevenLabsError  # noqa: E402
from app.models import CallTask  # noqa: E402

TASK = CallTask(
    to_number="+12155550142",
    callee_name="Dr. Rivera's office",
    user_name="Jordan Lee",
    goal="Book a teeth cleaning appointment.",
    facts={"Patient name": "Jordan Lee", "Date of birth": "March 14, 2005"},
    constraints=["I'm free Tuesday and Thursday afternoons."],
    timezone="America/New_York",
)


async def turn(ws: Any, callee_says: str) -> tuple[str, list[dict[str, Any]]]:
    """Send one callee line; collect the agent's reply and any tool calls until it goes quiet."""
    await ws.send(json.dumps({"type": "user_message", "text": callee_says}))
    said: list[str] = []
    tools: list[dict[str, Any]] = []
    while True:
        try:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=6 if (said or tools) else 30))
        except asyncio.TimeoutError:
            return " ".join(said), tools
        kind = msg.get("type")
        if kind == "ping":
            await ws.send(json.dumps({"type": "pong", "event_id": msg["ping_event"]["event_id"]}))
        elif kind == "agent_response":
            said.append(msg["agent_response_event"]["agent_response"])
        elif kind == "client_tool_call":
            call = msg["client_tool_call"]
            tools.append(call)
            if call["tool_name"] == "ask_user":
                return " ".join(said), tools  # the agent now waits for the user; that's the pass
        elif kind in ("error", "client_error"):
            raise ElevenLabsError(json.dumps(msg))


async def main() -> int:
    if not settings.elevenlabs_api_key:
        print("ELEVENLABS_API_KEY isn't set (in .env or the environment).")
        return 1
    client = ElevenLabsClient(settings)
    agent_id = await client.ensure_agent()
    print(f"Agent ready: {agent_id} (voice {settings.elevenlabs_voice_id}, LLM {settings.elevenlabs_llm})")
    url = await client.signed_url(agent_id)
    async with connect(url) as ws:
        await ws.send(
            json.dumps(
                {
                    "type": "conversation_initiation_client_data",
                    "conversation_config_override": {
                        "agent": {"prompt": {"prompt": build_instructions(TASK, TASK.facts)}},
                        "conversation": {"text_only": True},
                    },
                }
            )
        )
        first, _ = await turn(ws, "Dr. Rivera's office, how can I help you?")
        print(f"\nCallee: Dr. Rivera's office, how can I help you?\nAgent:  {first}")
        offer = "Sure. I have Thursday at 3 PM or Friday at 10 AM. Which works better?"
        second, tools = await turn(ws, offer)
        print(f"\nCallee: {offer}\nAgent:  {second}")
        for call in tools:
            print(f"        [tool call] {call['tool_name']}({json.dumps(call.get('parameters'))})")

    disclosed = "AI" in first
    asked = any(c["tool_name"] == "ask_user" for c in tools)
    print(f"\n{'PASS' if disclosed else 'FAIL'}  agent says it's an AI in its first turn")
    print(f"{'PASS' if asked else 'FAIL'}  agent hands the two-slot choice to the user (ask_user)")
    return 0 if disclosed and asked else 2


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except ElevenLabsError as exc:
        print(f"\n{exc}")
        sys.exit(1)
