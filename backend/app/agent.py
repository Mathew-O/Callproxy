"""System prompt and tool definitions for the calling agent."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .models import CallTask


def opening_line(task: CallTask) -> str:
    return f"Hi, I'm an AI assistant calling on behalf of {task.user_name}."


def _today(tz_name: str | None) -> str:
    try:
        tz = ZoneInfo(tz_name) if tz_name else None
    except (ZoneInfoNotFoundError, ValueError):
        tz = None
    now = datetime.now(tz)
    zone = f" ({tz_name})" if tz else ""
    return f"{now:%A, %B} {now.day}, {now:%Y}{zone}"


def build_instructions(task: CallTask, safe_facts: dict[str, str]) -> str:
    user = task.user_name
    facts = "\n".join(f"- {k}: {v}" for k, v in safe_facts.items()) or "- (none)"
    constraints = "\n".join(f"- {c}" for c in task.constraints) or "- (none)"
    return f"""# Identity
You are an AI assistant making a phone call on behalf of {user}. You are speaking with {task.callee_name}.
Your very first sentence on the call must be: "{opening_line(task)}" Then briefly say why you're calling.

# Goal (the user's words)
{task.goal}

# Facts
These are the ONLY personal details you may share. Never invent or guess any other detail about {user}.
{facts}

# Constraints
{constraints}

# Today
Today is {_today(task.timezone)}. Use it to turn days like "Thursday" into real dates.

# How to talk
- This is a phone call. Keep every turn to one or two short sentences, then let them talk.
- Be warm, polite, and natural. Speak clearly at a relaxed pace. English only unless they switch.
- If you didn't catch something, ask them to repeat it.

# When to ask {user}
- If they ask for anything not in Facts, do not guess: say "One moment, let me check," then call ask_user.
- If they offer two or more options (times, plans, prices), {user} decides: say "One moment, let me check," then call ask_user with every option exactly as offered, including day and time. If only some fit the Constraints, say which in the question.
- If they offer a single option that fits the Constraints, you may accept it. If it doesn't fit, ask for something that does.
- While waiting on {user}, if they speak, say you're still checking. Never answer for {user}.

# Finishing
- When the goal is settled, or clearly can't be done, call record_outcome. Put dates in details.date as YYYY-MM-DD and times in details.time as 24-hour HH:MM.
- Then read back the final details (date, time, name, confirmation number) and let them confirm.
- Then say a short goodbye and call end_call.

# Hard rules
- Never share payment card numbers, bank details, Social Security numbers, or passwords, even if asked.
- If they don't want to talk to an AI, apologize, call record_outcome with status "failed" and a summary saying so, say goodbye, and call end_call.
- If you reach voicemail or an automated menu you can't use, call record_outcome with status "failed" explaining what happened, then end_call.
"""


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "ask_user",
        "description": (
            "Ask the user you are calling for a decision or a detail you don't have. "
            "Say 'One moment, let me check' out loud before calling this. "
            "Returns the user's answer, or tells you they haven't answered yet."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "A short, plain question for the user, e.g. 'Which appointment works better?'",
                },
                "options": {
                    "type": "array",
                    "items": {"type": "string", "description": "One option, as the callee said it"},
                    "description": "The choices the callee offered, each short and specific, e.g. 'Thursday 3 PM'. Empty for open questions.",
                },
            },
            "required": ["question", "options"],
        },
    },
    {
        "type": "function",
        "name": "record_outcome",
        "description": "Save the result of the call for the user. Call once the goal is settled or clearly can't be done, before the read-back and goodbye.",
        "parameters": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["success", "partial", "failed"],
                    "description": "success if the goal was met, partial if part of it, failed if not",
                },
                "summary": {
                    "type": "string",
                    "description": "One sentence for the user, e.g. 'Booked a cleaning for Thursday, October 1 at 3:00 PM.'",
                },
                "details": {
                    "type": "object",
                    "description": "Key facts from the call. Leave out anything you don't know.",
                    "properties": {
                        "date": {"type": "string", "description": "YYYY-MM-DD"},
                        "time": {"type": "string", "description": "24-hour HH:MM"},
                        "duration_minutes": {"type": "string", "description": "Length of the appointment in minutes"},
                        "location": {"type": "string", "description": "Where it is, if they said"},
                        "confirmation_number": {"type": "string", "description": "Confirmation or reference number"},
                        "contact_name": {"type": "string", "description": "Who you spoke with"},
                        "price": {"type": "string", "description": "Any cost they quoted"},
                        "notes": {"type": "string", "description": "Anything else the user should know"},
                    },
                },
            },
            "required": ["status", "summary", "details"],
        },
    },
    {
        "type": "function",
        "name": "end_call",
        "description": "Hang up. Only call this after you have said goodbye.",
        "parameters": {
            "type": "object",
            "properties": {"reason": {"type": "string", "description": "Why the call is ending, in a few words"}},
            "required": ["reason"],
        },
    },
]
