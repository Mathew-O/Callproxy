"""Core objects from the spec, plus the few fields the live UI needs."""

from __future__ import annotations

import time
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CallState = Literal[
    "dialing",
    "ringing",
    "in_progress",
    "waiting_on_user",
    "wrapping_up",
    "completed",
    "no_answer",
    "failed",
]
TERMINAL_STATES: frozenset[str] = frozenset({"completed", "no_answer", "failed"})
Speaker = Literal["agent", "callee", "user"]
# Who does the talking: the AI agent, or the user typing lines that a voice reads out.
CallMode = Literal["agent", "direct"]
LineStatus = Literal["queued", "speaking", "spoken", "failed"]


class CallTask(BaseModel):
    to_number: str
    callee_name: str
    user_name: str
    goal: str = ""
    facts: dict[str, str] = Field(default_factory=dict)
    constraints: list[str] = Field(default_factory=list)
    # IANA zone from the browser so the agent can turn "Thursday" into a date.
    timezone: str | None = None
    mode: CallMode = "agent"
    # ElevenLabs voices: one reads the user's typed lines, the other is the agent's.
    my_voice_id: str | None = None
    agent_voice_id: str | None = None

    @field_validator("callee_name", "user_name", "to_number")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @model_validator(mode="after")
    def _agent_needs_a_goal(self) -> CallTask:
        # When the user types every line themselves, a goal is only a note to self.
        self.goal = self.goal.strip()
        if self.mode == "agent" and not self.goal:
            raise ValueError("goal: the agent needs a goal to work from")
        return self

    @field_validator("facts")
    @classmethod
    def _clean_facts(cls, value: dict[str, str]) -> dict[str, str]:
        return {k.strip(): v.strip() for k, v in value.items() if k.strip() and v.strip()}

    @field_validator("constraints")
    @classmethod
    def _clean_constraints(cls, value: list[str]) -> list[str]:
        return [c.strip() for c in value if c.strip()]


class CreateCallRequest(CallTask):
    simulate: bool = False


class TranscriptTurn(BaseModel):
    id: str
    speaker: Speaker
    text: str
    ts: float = Field(default_factory=time.time)
    final: bool = True
    # Lines the user typed carry the voice that read them and how far along they are.
    via: Literal["typed", "answer"] | None = None
    status: LineStatus | None = None
    voice: str | None = None


class Outcome(BaseModel):
    status: Literal["success", "partial", "failed"]
    summary: str
    details: dict[str, str] = Field(default_factory=dict)


class Question(BaseModel):
    id: str
    question: str
    options: list[str] = Field(default_factory=list)
    asked_at: float = Field(default_factory=time.time)
    timeout_s: float
    timed_out: bool = False


class Call(BaseModel):
    id: str
    task: CallTask
    state: CallState = "dialing"
    mode: CallMode = "agent"
    # Why the call ended up failed / no_answer, in words the user can read.
    detail: str | None = None
    simulated: bool = False
    twilio_sid: str | None = None
    transcript: list[TranscriptTurn] = Field(default_factory=list)
    outcome: Outcome | None = None
    pending_question: Question | None = None
    withheld_facts: list[str] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
    answered_at: float | None = None
    ended_at: float | None = None
    # Gap between the callee finishing a sentence and the agent's first audio, per turn.
    response_gaps_ms: list[int] = Field(default_factory=list)
    # Who is talking right now. Deaf users can't hear it, so the UI shows it.
    speaking: dict[str, bool] = Field(default_factory=lambda: {"agent": False, "callee": False, "you": False})
    voice_provider: str = "simulator"


class ReplyRequest(BaseModel):
    question_id: str
    answer: str

    @field_validator("answer")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class SayRequest(BaseModel):
    text: str
    voice_id: str | None = None

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        if len(value) > 500:
            raise ValueError("keep it under 500 characters")
        return value


class DemoRequest(BaseModel):
    live: bool = False


class ModeRequest(BaseModel):
    mode: CallMode


class TtsRequest(BaseModel):
    text: str
    voice_id: str

    @field_validator("text")
    @classmethod
    def _short(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 400:
            raise ValueError("text must be 1-400 characters")
        return value
