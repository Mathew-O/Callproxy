import { describe, expect, it } from "vitest";
import type { Call } from "../types";
import { feedReducer, initialFeed } from "./feed";
import { detailValue, formatDate, formatTime, orderedDetails } from "./format";
import { looksSensitive } from "./guardrails";
import { buildIcs, canAddToCalendar } from "./ics";

const baseCall: Call = {
  id: "c_1",
  task: {
    to_number: "+12155550142",
    callee_name: "Dr. Rivera's office",
    user_name: "Jordan Lee",
    goal: "Book a cleaning",
    facts: {},
    constraints: [],
    mode: "agent",
  },
  state: "ringing",
  mode: "agent",
  detail: null,
  simulated: true,
  transcript: [],
  outcome: null,
  pending_question: null,
  withheld_facts: [],
  created_at: 1000,
  answered_at: null,
  ended_at: null,
  response_gaps_ms: [],
  speaking: { agent: false, callee: false, you: false },
  voice_provider: "simulator",
  server_time: Date.now() / 1000,
};

describe("feedReducer", () => {
  const start = feedReducer(initialFeed, { type: "snapshot", data: baseCall });

  it("streams a partial line and replaces it when final", () => {
    let s = feedReducer(start, { type: "transcript", data: { id: "t1", speaker: "callee", text: "Hel", ts: 1, final: false } });
    s = feedReducer(s, { type: "transcript", data: { id: "t1", speaker: "callee", text: "Hello?", ts: 5, final: true } });
    expect(s.call?.transcript).toEqual([{ id: "t1", speaker: "callee", text: "Hello?", ts: 1, final: true }]);
  });

  it("drops a line that finishes empty (noise)", () => {
    let s = feedReducer(start, { type: "transcript", data: { id: "t1", speaker: "callee", text: "", ts: 1, final: false } });
    s = feedReducer(s, { type: "transcript", data: { id: "t1", speaker: "callee", text: "", ts: 2, final: true } });
    expect(s.call?.transcript).toEqual([]);
  });

  it("opens and closes the decision card", () => {
    const q = { question_id: "q1", question: "Which?", options: ["A", "B"], timeout_s: 30, asked_at: 1, timed_out: false };
    let s = feedReducer(start, { type: "ask_user", data: q });
    expect(s.call?.pending_question?.question_id).toBe("q1");
    s = feedReducer(s, { type: "question_closed", data: { question_id: "other" } });
    expect(s.call?.pending_question).not.toBeNull();
    s = feedReducer(s, { type: "question_closed", data: { question_id: "q1" } });
    expect(s.call?.pending_question).toBeNull();
  });

  it("tracks who is speaking", () => {
    const s = feedReducer(start, { type: "activity", data: { agent: false, callee: true, you: false } });
    expect(s.call?.speaking).toEqual({ agent: false, callee: true, you: false });
  });

  it("follows the user taking the call over", () => {
    const s = feedReducer(start, { type: "mode", data: { mode: "direct" } });
    expect(s.call?.mode).toBe("direct");
  });

  it("starts the timer when the call is answered", () => {
    const s = feedReducer(start, { type: "status", data: { state: "in_progress", detail: null } });
    expect(s.call?.state).toBe("in_progress");
    expect(s.call?.answered_at).toBeGreaterThan(0);
  });
});

describe("formatting", () => {
  it("formats outcome dates and times for people", () => {
    expect(formatDate("2026-10-01")).toBe("Thursday, October 1, 2026");
    expect(formatTime("15:00")).toBe("3:00 PM");
    expect(formatTime("00:30")).toBe("12:30 AM");
    expect(formatDate("next Thursday")).toBe("next Thursday");
    expect(detailValue("duration_minutes", "45")).toBe("45 minutes");
  });

  it("puts the details people scan for first", () => {
    const keys = orderedDetails({ notes: "x", confirmation_number: "1", date: "2026-10-01", time: "15:00" }).map(([k]) => k);
    expect(keys).toEqual(["date", "time", "confirmation_number", "notes"]);
  });
});

describe("ics", () => {
  it("needs a real date and time", () => {
    expect(canAddToCalendar({ date: "2026-10-01", time: "15:00" })).toBe(true);
    expect(canAddToCalendar({ date: "2026-02-30", time: "15:00" })).toBe(false);
    expect(canAddToCalendar({ date: "Thursday", time: "3 PM" })).toBe(false);
  });

  it("builds a floating-time event", () => {
    const ics = buildIcs(
      {
        uid: "c_1",
        title: "Cleaning at Dr. Rivera's office",
        date: "2026-10-01",
        time: "15:00",
        durationMinutes: 45,
        location: "Dr. Rivera's office, Suite 2",
        description: "Confirmation #: RC-4821\nBooked by CallProxy",
      },
      new Date(Date.UTC(2026, 8, 26, 18, 0, 0)),
    );
    const lines = ics.split("\r\n");
    expect(lines).toContain("DTSTART:20261001T150000");
    expect(lines).toContain("DTEND:20261001T154500");
    expect(lines).toContain("DTSTAMP:20260926T180000Z");
    expect(lines).toContain("LOCATION:Dr. Rivera's office\\, Suite 2");
    expect(lines).toContain("DESCRIPTION:Confirmation #: RC-4821\\nBooked by CallProxy");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("guardrails mirror", () => {
  it("flags the same facts the server withholds", () => {
    expect(looksSensitive("SSN", "123-45-6789")).toBe(true);
    expect(looksSensitive("Card", "4111 1111 1111 1111")).toBe(true);
    expect(looksSensitive("Portal password", "hunter2")).toBe(true);
    expect(looksSensitive("Date of birth", "March 14, 2005")).toBe(false);
    expect(looksSensitive("Insurance member ID", "123456789")).toBe(false);
    expect(looksSensitive("Callback number", "215-555-0142")).toBe(false);
  });
});
