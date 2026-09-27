"""In-memory call state, the UI event feed, and the tool logic shared by the
real voice bridge and the simulator."""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from typing import Any, Awaitable, Callable, Protocol

from .config import settings
from .models import (
    TERMINAL_STATES,
    Call,
    CallMode,
    CallState,
    CallTask,
    LineStatus,
    Outcome,
    Question,
    Speaker,
    TranscriptTurn,
)

log = logging.getLogger("callproxy.calls")

OUTCOME_DETAIL_KEYS = (
    "date",
    "time",
    "duration_minutes",
    "location",
    "confirmation_number",
    "contact_name",
    "price",
    "notes",
)


def new_id(prefix: str = "") -> str:
    return prefix + secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")


class VoiceLink(Protocol):
    """What the call runtime needs from whatever is producing the agent's voice."""

    async def speak_typed(self, line_id: str, text: str, voice_id: str | None) -> None:
        """Say a line the user typed, in their chosen voice, and report its status."""

    async def set_mode(self, mode: CallMode) -> None:
        """Pause the agent so the user can type (direct), or hand the call back (agent)."""

    async def deliver_late_answer(self, question: str, answer: str) -> None: ...

    async def warn_time_running_out(self, seconds_left: int) -> None: ...


class CallRuntime:
    """Live, non-serializable state for one call: pending question, hangup hooks,
    the voice link, and the call timer."""

    def __init__(self, store: CallStore, call: Call):
        self.store = store
        self.call = call
        self.voice: VoiceLink | None = None
        self.hangup_fn: Callable[[], Awaitable[None]] | None = None
        self.hangup_by: str | None = None  # "agent" | "user" | "limit" | "error" | None (callee)
        self.instructions = ""  # system prompt, built from the facts that passed the guardrails
        self.model_url: str | None = None  # pre-signed voice model URL, when the provider needs one
        self.stream_token = secrets.token_urlsafe(16)
        self.stream_connected = False
        self._answer: asyncio.Future[str] | None = None
        self._taken_over = False  # the user took the call while a question was open
        self._state_before_question: CallState = "in_progress"
        # Where in the transcript the user last took over, to brief the agent on hand-back.
        self.takeover_index = 0
        self._timer: asyncio.Task[None] | None = None
        self._tasks: set[asyncio.Task[Any]] = set()

    # ---- lifecycle -------------------------------------------------------

    def mark_answered(self) -> None:
        call = self.call
        if call.state not in ("dialing", "ringing"):
            return
        call.answered_at = time.time()
        self.store.set_state(call, "in_progress")
        self._timer = asyncio.create_task(self._enforce_time_limit())

    def finish(self, reason: str | None = None) -> None:
        """Move the call to its terminal state. Safe to call more than once."""
        call = self.call
        if call.state in TERMINAL_STATES:
            return
        call.ended_at = time.time()
        if self._answer and not self._answer.done():
            self._answer.cancel()
        if call.pending_question:
            call.pending_question = None
        # A call the user was typing themselves has no outcome to record: ending it is the
        # normal way it finishes, as long as someone picked up.
        if call.outcome or (call.mode == "direct" and call.answered_at):
            self.store.set_state(call, "completed")
        else:
            self.store.set_state(call, "failed", detail=reason or self._default_failure_reason())
        self._cleanup()
        self.store.publish(call.id, "snapshot", self.store.public_view(call))

    def no_answer(self, detail: str) -> None:
        call = self.call
        if call.state in TERMINAL_STATES:
            return
        call.ended_at = time.time()
        self.store.set_state(call, "no_answer", detail=detail)
        self._cleanup()
        self.store.publish(call.id, "snapshot", self.store.public_view(call))

    def _default_failure_reason(self) -> str:
        return {
            "user": "You ended the call before the task was finished.",
            "agent": "The agent ended the call without recording an outcome.",
            "limit": "The call reached the 5-minute limit before the task was finished.",
        }.get(self.hangup_by or "", "The other side hung up before the task was finished.")

    def _cleanup(self) -> None:
        if self._timer and not self._timer.done() and self._timer is not asyncio.current_task():
            self._timer.cancel()

    def spawn(self, coro: Awaitable[Any]) -> asyncio.Task[Any]:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def hang_up(self, by: str) -> None:
        if self.call.state in TERMINAL_STATES:
            return
        self.hangup_by = self.hangup_by or by
        if self.hangup_fn:
            try:
                await self.hangup_fn()
            except Exception:  # noqa: BLE001 - the call may already be gone
                log.exception("hangup failed for %s", self.call.id)

    async def _enforce_time_limit(self) -> None:
        limit = settings.max_call_seconds
        warn_at = max(limit - 30, 0)
        try:
            await asyncio.sleep(warn_at)
            if self.voice and self.call.state not in TERMINAL_STATES:
                await self.voice.warn_time_running_out(limit - warn_at)
            await asyncio.sleep(limit - warn_at)
        except asyncio.CancelledError:
            return
        if self.call.state not in TERMINAL_STATES:
            log.info("call %s hit the %ss limit", self.call.id, limit)
            await self.hang_up("limit")
            self.finish()

    # ---- transcript and activity -------------------------------------------

    def transcript(self, turn_id: str, speaker: Speaker, text: str, final: bool, **extra: Any) -> None:
        self.store.upsert_turn(self.call, turn_id, speaker, text, final, **extra)

    # ---- typing and taking over --------------------------------------------

    async def say(self, text: str, voice_id: str | None, voice_label: str) -> str:
        """Queue a typed line to be spoken on the call. Returns the line's id."""
        line_id = new_id("u_")
        self.transcript(line_id, "user", text, True, via="typed", status="queued", voice=voice_label)
        if self.voice:
            self.spawn(self.voice.speak_typed(line_id, text, voice_id))
        return line_id

    def line_status(self, line_id: str, status: LineStatus) -> None:
        for turn in self.call.transcript:
            if turn.id == line_id:
                self.transcript(line_id, "user", turn.text, True, via="typed", status=status, voice=turn.voice)
                return

    async def switch_mode(self, mode: CallMode) -> None:
        call = self.call
        if call.mode == mode or call.state in TERMINAL_STATES:
            return
        log.info("call %s: %s mode", call.id, mode)
        call.mode = mode
        if mode == "direct":
            self.takeover_index = len(call.transcript)
            q = call.pending_question
            if q and not q.timed_out and self._answer and not self._answer.done():
                # The user is taking the call themselves; the agent's question is moot.
                self._taken_over = True
                self._answer.set_result("")
            if q:
                call.pending_question = None
                self.store.publish(call.id, "question_closed", {"question_id": q.id})
                if call.state == "waiting_on_user":
                    self.store.set_state(call, self._state_before_question)
        self.store.publish(call.id, "mode", {"mode": mode})
        if self.voice:
            await self.voice.set_mode(mode)

    def handback_brief(self) -> str:
        """What the agent missed while the user was typing, for when it takes the call back."""
        user = self.call.task.user_name
        lines = []
        for turn in self.call.transcript[self.takeover_index :]:
            if not turn.final or not turn.text.strip():
                continue
            who = {"user": f"{user} (typed, read aloud)", "callee": self.call.task.callee_name}.get(turn.speaker, "You")
            lines.append(f"{who}: {turn.text}")
        said = "\n".join(lines[-20:]) or "(nothing yet)"
        return (
            f"{user} was typing on this call themselves and has now handed it back to you. "
            f"Here is what was said while you were paused:\n{said}\n"
            "Pick up naturally from here; don't repeat your introduction."
        )
    def set_activity(
        self, *, agent: bool | None = None, callee: bool | None = None, you: bool | None = None
    ) -> None:
        speaking = self.call.speaking
        changed = False
        for who, value in (("agent", agent), ("callee", callee), ("you", you)):
            if value is not None and speaking.get(who) != value:
                speaking[who] = value
                changed = True
        if changed:
            self.store.publish(self.call.id, "activity", dict(speaking))

    # ---- tools -----------------------------------------------------------

    async def handle_tool(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        if name == "ask_user":
            options = [str(o).strip() for o in args.get("options") or [] if str(o).strip()]
            return await self.ask_user(str(args.get("question", "")).strip(), options)
        if name == "record_outcome":
            return self.record_outcome(args)
        if name == "end_call":
            return self.end_call(str(args.get("reason", "")))
        return {"error": f"Unknown tool {name}"}

    async def ask_user(self, question: str, options: list[str]) -> dict[str, Any]:
        call = self.call
        if not question:
            return {"error": "question is required"}
        if call.mode == "direct":
            return {"answered": False, "note": f"{call.task.user_name} is typing to the callee directly. Stay quiet."}
        if call.pending_question and not call.pending_question.timed_out:
            return {
                "answered": False,
                "note": "You are already waiting on the user's answer to an earlier question. "
                "Tell the callee you're still checking.",
            }
        q = Question(
            id=new_id("q_"),
            question=question,
            options=options[:6],
            timeout_s=settings.ask_user_timeout_s,
        )
        call.pending_question = q
        if call.state != "waiting_on_user":
            self._state_before_question = call.state
        self._answer = asyncio.get_running_loop().create_future()
        self.store.set_state(call, "waiting_on_user")
        self.store.publish(call.id, "ask_user", _question_event(q))
        user = call.task.user_name
        self._taken_over = False
        try:
            answer = await asyncio.wait_for(asyncio.shield(self._answer), q.timeout_s)
        except asyncio.TimeoutError:
            q.timed_out = True
            if call.state == "waiting_on_user":
                self.store.set_state(call, self._state_before_question)
            self.store.publish(call.id, "ask_user", _question_event(q))
            return {
                "answered": False,
                "note": f"{user} hasn't answered yet. Politely tell the callee you need to check "
                f"with {user} and offer to call back, or ask whether they can hold a little longer. "
                f"If {user} answers later you will receive a message with the answer.",
            }
        except asyncio.CancelledError:
            if self._answer.cancelled():  # finish() cancelled it; the call is over
                return {"answered": False, "note": "The call is ending."}
            raise
        if self._taken_over:
            return {"answered": False, "note": f"{user} took over the call and is typing to the callee directly."}
        return {"answered": True, "answer": answer}

    async def reply(self, question_id: str, answer: str) -> bool:
        call = self.call
        q = call.pending_question
        if not q or q.id != question_id or call.state in TERMINAL_STATES:
            return False
        call.pending_question = None
        self.transcript(new_id("u_"), "user", answer, True, via="answer")
        self.store.publish(call.id, "question_closed", {"question_id": q.id})
        if not q.timed_out and self._answer and not self._answer.done():
            self._answer.set_result(answer)
            if call.state == "waiting_on_user":
                self.store.set_state(call, self._state_before_question)
        elif self.voice:
            # The agent already told the callee we'd follow up; pass the answer on now.
            await self.voice.deliver_late_answer(q.question, answer)
        return True

    def record_outcome(self, args: dict[str, Any]) -> dict[str, Any]:
        call = self.call
        status = args.get("status")
        if status not in ("success", "partial", "failed"):
            status = "partial"
        raw_details = args.get("details") or {}
        details = {
            str(k): str(v).strip()
            for k, v in (raw_details.items() if isinstance(raw_details, dict) else [])
            if v is not None and str(v).strip()
        }
        call.outcome = Outcome(status=status, summary=str(args.get("summary", "")).strip(), details=details)
        self.store.publish(call.id, "outcome", call.outcome.model_dump())
        if call.state in ("in_progress", "waiting_on_user"):
            self.store.set_state(call, "wrapping_up")
        return {
            "saved": True,
            "next": "Read back the key details (date, time, name, confirmation number) to confirm, "
            "then say goodbye and call end_call.",
        }

    def end_call(self, reason: str) -> dict[str, Any]:
        self.hangup_by = self.hangup_by or "agent"
        log.info("agent ended call %s: %s", self.call.id, reason)
        return {"ok": True}


def _question_event(q: Question) -> dict[str, Any]:
    return {
        "question_id": q.id,
        "question": q.question,
        "options": q.options,
        "timeout_s": q.timeout_s,
        "asked_at": q.asked_at,
        "timed_out": q.timed_out,
    }


class CallStore:
    def __init__(self) -> None:
        self.calls: dict[str, Call] = {}
        self.runtimes: dict[str, CallRuntime] = {}
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}

    def create(self, task: CallTask, *, simulated: bool, withheld: list[str]) -> CallRuntime:
        call = Call(id=new_id("c_"), task=task, mode=task.mode, simulated=simulated, withheld_facts=withheld)
        self.calls[call.id] = call
        runtime = CallRuntime(self, call)
        self.runtimes[call.id] = runtime
        return runtime

    def get(self, call_id: str) -> Call | None:
        return self.calls.get(call_id)

    def runtime(self, call_id: str) -> CallRuntime | None:
        return self.runtimes.get(call_id)

    # ---- events ----------------------------------------------------------

    def subscribe(self, call_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subscribers.setdefault(call_id, set()).add(queue)
        return queue

    def unsubscribe(self, call_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        subs = self._subscribers.get(call_id)
        if subs:
            subs.discard(queue)

    def publish(self, call_id: str, event_type: str, data: dict[str, Any]) -> None:
        event = {"type": event_type, "data": data}
        for queue in list(self._subscribers.get(call_id, ())):
            queue.put_nowait(event)

    # ---- mutations -------------------------------------------------------

    def set_state(self, call: Call, state: CallState, detail: str | None = None) -> bool:
        if call.state in TERMINAL_STATES:
            return False
        if call.state == state and detail is None:
            return False
        log.info("call %s: %s -> %s%s", call.id, call.state, state, f" ({detail})" if detail else "")
        call.state = state
        if detail is not None:
            call.detail = detail
        self.publish(call.id, "status", {"state": state, "detail": call.detail})
        return True

    def upsert_turn(
        self, call: Call, turn_id: str, speaker: Speaker, text: str, final: bool, **extra: Any
    ) -> None:
        for i, turn in enumerate(call.transcript):
            if turn.id == turn_id:
                if final and not text.strip():
                    del call.transcript[i]
                else:
                    turn.text = text
                    turn.final = final
                    for key, value in extra.items():
                        setattr(turn, key, value)
                break
        else:
            if final and not text.strip():
                return
            call.transcript.append(TranscriptTurn(id=turn_id, speaker=speaker, text=text, final=final, **extra))
        self.publish(
            call.id,
            "transcript",
            {"id": turn_id, "speaker": speaker, "text": text, "final": final, "ts": time.time(), **extra},
        )

    def public_view(self, call: Call) -> dict[str, Any]:
        data = call.model_dump()
        # The UI needs the question in the same shape as the ask_user event.
        data["pending_question"] = _question_event(call.pending_question) if call.pending_question else None
        # Lets the browser run the call timer off the server clock.
        data["server_time"] = time.time()
        return data


store = CallStore()
