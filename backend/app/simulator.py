"""A practice call: a scripted dental receptionist who reacts to whatever is said to her,
whether the AI agent is talking or the user is typing lines for their voice to read.

It drives the same runtime, tools, and UI events as a live call, so the whole app can
be demoed with no phone or keys. It also emits `sim_speech` events so the browser can
voice every line (ElevenLabs when there's a key, the browser's own voice otherwise).

Dial a number ending in 0000 to simulate nobody picking up.
"""

from __future__ import annotations

import asyncio
import re
from datetime import date, timedelta

from .agent import opening_line
from .calls import CallRuntime, new_id
from .config import Settings
from .models import TERMINAL_STATES, CallMode
from .voices import RECEPTIONIST_VOICE_ID

WORD_S = 0.33  # about 180 words a minute, close to how fast the voices actually talk
CONFIRMATION = "RC-4821"

BOOKING = re.compile(r"\b(book|appointment|appt|clean|cleaning|schedule|check-?up|visit|see the dentist|come in)", re.I)
DATE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b|\b(19|20)\d\d\b",
    re.I,
)
REPEAT = re.compile(r"\brepeat\b|say that again|didn'?t (catch|get) that|pardon", re.I)
SLOWER = re.compile(r"\bslow", re.I)
HOLD = re.compile(r"one moment|hold on|just a (sec|second|moment)|give me a (sec|second|moment)|bear with", re.I)
DONE = re.compile(r"\b(no|nope|that'?s (all|it|everything)|nothing else|bye|goodbye|thank)", re.I)
REMINDER = re.compile(r"\b(text|remind|reminder|message|email)", re.I)


def _next_weekday(today: date, weekday: int) -> date:
    days = (weekday - today.weekday()) % 7 or 7
    return today + timedelta(days=days)


def _ordinal(n: int) -> str:
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


class Simulator:
    def __init__(self, runtime: CallRuntime, settings: Settings, safe_facts: dict[str, str]):
        self.rt = runtime
        self.s = settings
        self.speed = max(settings.simulator_speed, 0.01)
        self.facts = safe_facts
        self._line = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self.typed: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
        self.mode_changed = asyncio.Event()
        self.stage = "greet"
        self.last_callee_line = ""
        self.booked = ""

        today = date.today()
        thu, fri = _next_weekday(today, 3), _next_weekday(today, 4)
        self.slots = [
            (f"Thursday, {thu:%B} {_ordinal(thu.day)} at 3 PM", thu.isoformat(), "15:00", re.compile(r"thu|first|\b3\b|three", re.I)),
            (f"Friday, {fri:%B} {_ordinal(fri.day)} at 10 AM", fri.isoformat(), "10:00", re.compile(r"fri|second|\b10\b|ten\b", re.I)),
        ]

    def start(self) -> None:
        self.rt.voice = self
        self.rt.hangup_fn = self._hang_up
        self._task = self.rt.spawn(self._run())

    async def _hang_up(self) -> None:
        if self._task and not self._task.done() and self._task is not asyncio.current_task():
            self._task.cancel()

    @property
    def mode(self) -> CallMode:
        return self.rt.call.mode

    # ---- VoiceLink --------------------------------------------------------------

    async def speak_typed(self, line_id: str, text: str, voice_id: str | None) -> None:
        if self.mode == "direct":
            # The conversation loop voices it and the receptionist answers.
            await self.typed.put((line_id, text))
            return
        # Typed while the agent has the call: an interjection.
        await self._voice_typed(line_id, text)
        if REPEAT.search(text) or SLOWER.search(text) or HOLD.search(text):
            await self._receptionist(text, from_agent=False)

    async def set_mode(self, mode: CallMode) -> None:
        self.mode_changed.set()
        if mode == "agent":
            while not self.typed.empty():
                line_id, text = self.typed.get_nowait()
                self.rt.spawn(self._voice_typed(line_id, text))

    async def deliver_late_answer(self, question: str, answer: str) -> None:
        self.rt.spawn(self._speak("agent", f"Good news, {self.rt.call.task.user_name} just got back to me: {answer}."))

    async def warn_time_running_out(self, seconds_left: int) -> None:
        return None

    # ---- speaking ----------------------------------------------------------------

    async def _pause(self, seconds: float) -> None:
        await asyncio.sleep(seconds / self.speed)

    def _voice_for(self, speaker: str) -> str:
        task = self.rt.call.task
        if speaker == "callee":
            return RECEPTIONIST_VOICE_ID
        if speaker == "user":
            return task.my_voice_id or self.s.elevenlabs_my_voice_id
        return task.agent_voice_id or self.s.elevenlabs_voice_id

    def _announce(self, turn_id: str, speaker: str, text: str) -> None:
        self.rt.store.publish(
            self.rt.call.id,
            "sim_speech",
            {"id": turn_id, "speaker": speaker, "text": text, "voice_id": self._voice_for(speaker)},
        )

    async def _speak(self, speaker: str, text: str) -> str:
        """Stream a line word by word at speaking pace. Returns what actually got said: the
        agent stops mid-sentence if the user takes the call."""
        async with self._line:
            rt = self.rt
            if rt.call.state in TERMINAL_STATES:
                return ""
            turn_id = new_id("sim_")
            words = text.split()
            said = text
            self._announce(turn_id, speaker, text)
            rt.set_activity(**{speaker: True})
            if speaker == "callee":
                rt.transcript(turn_id, "callee", "", False)
                await self._pause(0.4)
            for i in range(1, len(words) + 1):
                if speaker == "agent" and self.mode == "direct":
                    said = " ".join(words[: i - 1])
                    said = f"{said}…" if said else ""
                    break
                rt.transcript(turn_id, speaker, " ".join(words[:i]), False)  # type: ignore[arg-type]
                await self._pause(WORD_S)
            rt.transcript(turn_id, speaker, said, True)  # type: ignore[arg-type]
            rt.set_activity(**{speaker: False})
            if speaker == "callee":
                self.last_callee_line = text
            await self._pause(0.5)
            return said

    async def _voice_typed(self, line_id: str, text: str) -> None:
        async with self._line:
            rt = self.rt
            if rt.call.state in TERMINAL_STATES:
                rt.line_status(line_id, "failed")
                return
            self._announce(line_id, "user", text)
            rt.line_status(line_id, "speaking")
            rt.set_activity(you=True)
            await self._pause(WORD_S * 1.1 * len(text.split()) + 0.4)
            rt.set_activity(you=False)
            rt.line_status(line_id, "spoken")
            await self._pause(0.4)

    # ---- the conversation ------------------------------------------------------------

    async def _run(self) -> None:
        rt = self.rt
        call = rt.call
        task = call.task
        try:
            await self._pause(1.2)
            rt.store.set_state(call, "ringing")
            if re.sub(r"\D", "", task.to_number).endswith("0000"):
                await self._pause(6)
                rt.no_answer("No one picked up after 30 seconds.")
                return
            await self._pause(3)
            rt.mark_answered()
            await self._speak("callee", f"Good afternoon, {task.callee_name}, this is Maria. How can I help you?")

            while self.stage != "done" and call.state not in TERMINAL_STATES:
                if self.mode == "agent":
                    said = await self._agent_turn()
                    if said:
                        await self._receptionist(said, from_agent=True)
                else:
                    text = await self._typed_turn()
                    if text:
                        await self._receptionist(text, from_agent=False)

            if call.state not in TERMINAL_STATES:
                rt.end_call("goal complete")
                await self._pause(0.8)
                rt.finish()
        except asyncio.CancelledError:
            pass

    async def _typed_turn(self) -> str | None:
        """Wait for the user's next typed line (or for them to hand the call back)."""
        self.mode_changed.clear()
        get = asyncio.ensure_future(self.typed.get())
        changed = asyncio.ensure_future(self.mode_changed.wait())
        done, _ = await asyncio.wait({get, changed}, return_when=asyncio.FIRST_COMPLETED)
        if get not in done:
            get.cancel()
            return None
        changed.cancel()
        line_id, text = get.result()
        await self._voice_typed(line_id, text)
        return text

    async def _agent_turn(self) -> str | None:
        rt = self.rt
        task = rt.call.task
        user = task.user_name
        if self.stage == "greet":
            spoke_already = any(t.speaker == "user" for t in rt.call.transcript)
            intro = f"Hi, I'm an AI assistant helping {user} with this call." if spoke_already else opening_line(task)
            goal = task.goal.strip().rstrip(".") or "booking an appointment"
            return await self._speak("agent", f"{intro} I'm calling about this: {goal}.")

        if self.stage == "dob":
            dob = next((v for k, v in self.facts.items() if re.search(r"birth|dob", k, re.I)), None)
            if dob:
                return await self._speak("agent", f"Of course, it's {dob}.")
            await self._speak("agent", "One moment, let me check.")
            answer = await self._ask("They're asking for your date of birth. What should I tell them?", [])
            return await self._speak("agent", f"Thanks for waiting. It's {answer}.") if answer else None

        if self.stage == "slots":
            await self._speak("agent", "One moment, let me check.")
            answer = await self._ask("Which appointment works better?", [s[0] for s in self.slots])
            return await self._speak("agent", f"{answer} works. Please book that one.") if answer else None

        if self.stage == "confirm":
            return await self._speak(
                "agent", f"Just to confirm: {self.booked}, for {user}, confirmation number R C 4 8 2 1. Is that right?"
            )

        # anything_else
        return await self._speak("agent", "No, that's everything. Thank you so much, goodbye!")

    async def _ask(self, question: str, options: list[str]) -> str | None:
        """Ask the user. None means they took the call over or didn't answer in time."""
        result = await self.rt.handle_tool("ask_user", {"question": question, "options": options})
        if result.get("answered"):
            return str(result["answer"])
        if self.mode == "direct":
            return None  # they're typing now; the loop hands the turn to them
        await self._give_up_politely()
        return None

    async def _give_up_politely(self) -> None:
        user = self.rt.call.task.user_name
        await self._speak("agent", f"I'm sorry, I need to check with {user} first. Could we call you back?")
        await self._speak("callee", "Of course. Just call back whenever you're ready.")
        self.rt.record_outcome(
            {
                "status": "partial",
                "summary": "You didn't answer in time, so the agent told them you'd call back.",
                "details": {"contact_name": "Maria", "notes": "Call back to finish booking."},
            }
        )
        self.stage = "done"

    async def _receptionist(self, line: str, *, from_agent: bool) -> None:
        """Maria's side: react to what the caller (agent or typed voice) just said."""
        text = line.lower()
        slot_list = f"{self.slots[0][0]}, or {self.slots[1][0]}"
        if REPEAT.search(text):
            await self._speak("callee", f"Sure. {self.last_callee_line}")
            return
        if SLOWER.search(text):
            await self._speak("callee", f"Sorry about that! {self.last_callee_line}")
            return
        if HOLD.search(text) and not from_agent:
            await self._speak("callee", "Sure, take your time.")
            return

        if self.stage == "greet":
            if from_agent or BOOKING.search(text):
                self.stage = "dob"
                await self._speak("callee", "Sure, I can help with that. Can I get the patient's date of birth?")
            else:
                await self._speak("callee", "No problem at all, thanks for letting me know. How can I help you today?")
        elif self.stage == "dob":
            if from_agent or DATE.search(text):
                self.stage = "slots"
                await self._speak("callee", f"Thanks, I found you. I have two openings: {slot_list}. Which works better?")
            else:
                await self._speak("callee", "Sorry, I just need the patient's date of birth to look them up.")
        elif self.stage == "slots":
            slot = next((s for s in self.slots if s[3].search(text)), None)
            if not slot:
                await self._speak("callee", f"I only have those two right now: {slot_list}.")
                return
            label, day, time_, _ = slot
            await self._speak("callee", f"You're all set for {label}. Your confirmation number is R C 4 8 2 1.")
            task = self.rt.call.task
            self.rt.record_outcome(
                {
                    "status": "success",
                    "summary": f"Booked {label} at {task.callee_name}.",
                    "details": {
                        "date": day,
                        "time": time_,
                        "confirmation_number": CONFIRMATION,
                        "location": task.callee_name,
                        "contact_name": "Maria",
                    },
                }
            )
            self.booked = label
            self.stage = "confirm"
        elif self.stage == "confirm":
            self.stage = "anything_else"
            await self._speak("callee", "Perfect. Is there anything else I can help you with?")
        elif self.stage == "anything_else":
            if REMINDER.search(text):
                await self._speak("callee", "Sure, I've set up a text reminder for the day before. Anything else?")
            elif DONE.search(text) or from_agent:
                self.stage = "done"
                await self._speak("callee", "Great. Have a wonderful day! Bye now.")
            else:
                await self._speak("callee", "Got it, I've made a note of that. Anything else I can help with?")
