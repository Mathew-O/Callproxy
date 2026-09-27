import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_TASK } from "../lib/demo";
import type { FeedEvent } from "../types";
import { localEngine } from "./engine";

beforeAll(() => {
  localEngine.speed = 200;
});

async function until(check: () => boolean, what: string, timeout = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function start(overrides: Partial<typeof DEMO_TASK> = {}) {
  const id = localEngine.create({ ...DEMO_TASK, ...overrides });
  const events: FeedEvent[] = [];
  localEngine.subscribe(id, (e) => events.push(e));
  const call = () => localEngine.get(id).snapshot();
  const calleeSaid = (text: string) => call().transcript.some((t) => t.speaker === "callee" && t.final && t.text.includes(text));
  return { id, events, call, calleeSaid, engine: localEngine.get(id) };
}

describe("browser-only practice call", () => {
  it("runs a call the user types themselves", async () => {
    const { call, calleeSaid, engine, events } = start();
    await until(() => calleeSaid("How can I help you?"), "greeting");
    engine.say("Hi, I'd like to book a cleaning.", null);
    await until(() => calleeSaid("date of birth"), "birthday question");
    engine.say("March 14, 2005", null);
    await until(() => calleeSaid("two openings"), "slots");
    engine.say("Friday works.", null);
    await until(() => call().outcome !== null, "booking");
    expect(call().outcome?.details.time).toBe("10:00");
    engine.say("No, that's all. Bye!", null);
    await until(() => calleeSaid("Anything else") || calleeSaid("anything else"), "anything else");
    engine.say("No, that's all. Bye!", null);
    await until(() => call().state === "completed", "completed");
    const typed = call().transcript.filter((t) => t.via === "typed");
    expect(typed.every((t) => t.status === "spoken" && t.voice === "River")).toBe(true);
    expect(events.some((e) => e.type === "sim_speech" && e.data.speaker === "user")).toBe(true);
  });

  it("hands off to the agent, asks the user, and finishes", async () => {
    const { call, calleeSaid, engine } = start();
    await until(() => calleeSaid("How can I help you?"), "greeting");
    engine.setMode("agent");
    await until(() => call().pending_question !== null, "decision card");
    const q = call().pending_question!;
    expect(q.options).toHaveLength(2);
    expect(engine.reply(q.question_id, q.options[0])).toBe(true);
    await until(() => call().state === "completed", "completed");
    expect(call().outcome?.details.time).toBe("15:00");
    expect(call().transcript.some((t) => t.speaker === "agent" && t.text.startsWith("Hi, I'm an AI assistant"))).toBe(true);
  });

  it("closes the decision card when the user takes over", async () => {
    const { call, calleeSaid, engine } = start({ mode: "agent" });
    await until(() => call().pending_question !== null, "decision card");
    engine.setMode("direct");
    expect(call().pending_question).toBeNull();
    await until(() => call().state === "in_progress", "back to talking");
    engine.say("Thursday please.", null);
    await until(() => calleeSaid("You're all set for Thursday"), "booked by typing");
  });

  it("simulates nobody answering", async () => {
    const { call } = start({ to_number: "+12155550000" });
    await until(() => call().state === "no_answer", "no answer");
  });
});
