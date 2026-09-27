"""Hello-world check for the voice model: sends CallProxy's real session config to the
OpenAI Realtime API, then runs two text-only turns of the demo to confirm the agent
discloses it's an AI and hands a two-slot choice to the user via ask_user.

Costs a fraction of a cent. No phone or Twilio needed.

    backend/.venv/Scripts/python backend/scripts/check_realtime.py
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
from app.models import CallTask  # noqa: E402
from app.realtime import session_config  # noqa: E402

TASK = CallTask(
    to_number="+12155550142",
    callee_name="Dr. Rivera's office",
    user_name="Jordan Lee",
    goal="Book a teeth cleaning appointment.",
    facts={"Patient name": "Jordan Lee", "Date of birth": "March 14, 2005"},
    constraints=["I'm free Tuesday and Thursday afternoons."],
    timezone="America/New_York",
)


async def next_event(ws: Any, *types: str) -> dict[str, Any]:
    while True:
        event = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
        if event["type"] == "error":
            raise RuntimeError(json.dumps(event["error"], indent=2))
        if event["type"] in types:
            return event


async def text_turn(ws: Any, callee_says: str) -> list[dict[str, Any]]:
    await ws.send(
        json.dumps(
            {
                "type": "conversation.item.create",
                "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": callee_says}]},
            }
        )
    )
    await ws.send(json.dumps({"type": "response.create", "response": {"output_modalities": ["text"]}}))
    done = await next_event(ws, "response.done")
    return done["response"].get("output", [])


def describe(output: list[dict[str, Any]]) -> str:
    parts = []
    for item in output:
        if item.get("type") == "function_call":
            parts.append(f"[tool call] {item['name']}({item.get('arguments')})")
        for content in item.get("content") or []:
            if content.get("text") or content.get("transcript"):
                parts.append(content.get("text") or content.get("transcript"))
    return "\n    ".join(parts) or "(no output)"


async def main() -> int:
    if not settings.openai_api_key:
        print("OPENAI_API_KEY isn't set (in .env or the environment).")
        return 1
    url = f"{settings.realtime_url}?model={settings.realtime_model}"
    print(f"Connecting to {url}")
    async with connect(url, additional_headers={"Authorization": f"Bearer {settings.openai_api_key}"}) as ws:
        await next_event(ws, "session.created")
        await ws.send(
            json.dumps(
                {"type": "session.update", "session": session_config(settings, build_instructions(TASK, TASK.facts))}
            )
        )
        session = (await next_event(ws, "session.updated"))["session"]
        audio = session.get("audio", {})
        print("Session accepted:")
        print(f"  model        {session.get('model')}")
        print(f"  audio in     {audio.get('input', {}).get('format')}")
        print(f"  audio out    {audio.get('output', {}).get('format')}  voice={audio.get('output', {}).get('voice')}")
        print(f"  transcripts  {audio.get('input', {}).get('transcription')}")
        print(f"  tools        {[t['name'] for t in session.get('tools', [])]}")

        first = await text_turn(ws, "Dr. Rivera's office, how can I help you?")
        print(f"\nCallee: Dr. Rivera's office, how can I help you?\nAgent:  {describe(first)}")
        offer = "Sure. I have Thursday at 3 PM or Friday at 10 AM. Which works better?"
        second = await text_turn(ws, offer)
        print(f"\nCallee: {offer}\nAgent:  {describe(second)}")

    disclosed = "AI" in describe(first)
    asked = any(i.get("type") == "function_call" and i.get("name") == "ask_user" for i in second)
    print(f"\n{'PASS' if disclosed else 'FAIL'}  agent says it's an AI in its first turn")
    print(f"{'PASS' if asked else 'FAIL'}  agent hands the two-slot choice to the user (ask_user)")
    return 0 if disclosed and asked else 2


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except RuntimeError as exc:
        print(f"\nThe Realtime API returned an error:\n{exc}")
        sys.exit(1)
