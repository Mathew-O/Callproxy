/**
 * The practice call, running entirely in the browser. Used by the static build (the
 * GitHub Pages demo link), where there's no backend. It mirrors backend/app/calls.py
 * and backend/app/simulator.py: same receptionist, same events, same rules.
 */
import type {
  Call,
  CallMode,
  CallState,
  CallTask,
  FeedEvent,
  LineStatus,
  Outcome,
  Question,
  Speaker,
  TranscriptTurn,
} from "../types";
import { DEFAULT_AGENT_VOICE, DEFAULT_MY_VOICE, RECEPTIONIST_VOICE, voiceName } from "./voices";

const WORD_S = 0.33;
const ASK_TIMEOUT_S = 30;
const TERMINAL: CallState[] = ["completed", "no_answer", "failed"];

const BOOKING = /\b(book|appointment|appt|clean|cleaning|schedule|check-?up|visit|see the dentist|come in)/i;
const DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b|\b(19|20)\d\d\b/i;
const REPEAT = /\brepeat\b|say that again|didn'?t (catch|get) that|pardon/i;
const SLOWER = /\bslow/i;
const HOLD = /one moment|hold on|just a (sec|second|moment)|give me a (sec|second|moment)|bear with/i;
const DONE = /\b(no|nope|that'?s (all|it|everything)|nothing else|bye|goodbye|thank)/i;
const REMINDER = /\b(text|remind|reminder|message|email)/i;

class Cancelled extends Error {}

const now = () => Date.now() / 1000;
let counter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

function nextWeekday(from: Date, weekday: number): Date {
  const days = (weekday - from.getDay() + 7) % 7 || 7;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

interface Slot {
  label: string;
  date: string;
  time: string;
  pattern: RegExp;
}

class LocalCall {
  call: Call;
  listeners = new Set<(e: FeedEvent) => void>();
  private speed: number;
  private cancelled = false;
  private line = new Mutex();
  private typed: { lineId: string; text: string }[] = [];
  private wake: (() => void) | null = null;
  private answer: ((value: string | null) => void) | null = null;
  private takenOver = false;
  private stateBeforeQuestion: CallState = "in_progress";
  private stage: "greet" | "dob" | "slots" | "confirm" | "anything_else" | "done" = "greet";
  private lastCalleeLine = "";
  private booked = "";
  private slots: Slot[];
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(task: CallTask, speed: number) {
    this.speed = speed;
    this.call = {
      id: newId("local_"),
      task,
      state: "dialing",
      mode: task.mode,
      detail: null,
      simulated: true,
      transcript: [],
      outcome: null,
      pending_question: null,
      withheld_facts: [],
      created_at: now(),
      answered_at: null,
      ended_at: null,
      response_gaps_ms: [],
      speaking: { agent: false, callee: false, you: false },
      voice_provider: "simulator",
      server_time: now(),
    };
    const today = new Date();
    const thu = nextWeekday(today, 4);
    const fri = nextWeekday(today, 5);
    const month = (d: Date) => d.toLocaleDateString("en-US", { month: "long" });
    this.slots = [
      { label: `Thursday, ${month(thu)} ${ordinal(thu.getDate())} at 3 PM`, date: iso(thu), time: "15:00", pattern: /thu|first|\b3\b|three/i },
      { label: `Friday, ${month(fri)} ${ordinal(fri.getDate())} at 10 AM`, date: iso(fri), time: "10:00", pattern: /fri|second|\b10\b|ten\b/i },
    ];
    void this.run();
  }

  // ---- events & state ----------------------------------------------------------

  snapshot(): Call {
    return structuredClone({ ...this.call, server_time: now() });
  }

  private publish(event: FeedEvent) {
    this.listeners.forEach((l) => l(structuredClone(event)));
  }

  /** Read fresh each time: the user can switch modes while a turn is awaiting. */
  private isDirect() {
    return this.call.mode === "direct";
  }

  private get terminal() {
    return TERMINAL.includes(this.call.state);
  }

  private setState(state: CallState, detail?: string) {
    if (this.terminal || (this.call.state === state && detail === undefined)) return;
    this.call.state = state;
    if (detail !== undefined) this.call.detail = detail;
    this.publish({ type: "status", data: { state, detail: this.call.detail } });
  }

  private transcript(id: string, speaker: Speaker, text: string, final: boolean, extra: Partial<TranscriptTurn> = {}) {
    const list = this.call.transcript;
    const i = list.findIndex((t) => t.id === id);
    if (i >= 0) {
      if (final && !text.trim()) list.splice(i, 1);
      else list[i] = { ...list[i], text, final, ...extra };
    } else if (!(final && !text.trim())) {
      list.push({ id, speaker, text, final, ts: now(), ...extra });
    }
    this.publish({ type: "transcript", data: { id, speaker, text, final, ts: now(), ...extra } as TranscriptTurn });
  }

  private activity(who: keyof Call["speaking"], on: boolean) {
    if (this.call.speaking[who] === on) return;
    this.call.speaking = { ...this.call.speaking, [who]: on };
    this.publish({ type: "activity", data: { ...this.call.speaking } });
  }

  private lineStatus(lineId: string, status: LineStatus) {
    const turn = this.call.transcript.find((t) => t.id === lineId);
    if (turn) this.transcript(lineId, "user", turn.text, true, { via: "typed", status, voice: turn.voice });
  }

  private finish(reason?: string) {
    if (this.terminal) return;
    this.call.ended_at = now();
    this.call.pending_question = null;
    this.answer?.(null);
    if (this.call.outcome || (this.call.mode === "direct" && this.call.answered_at)) this.setState("completed");
    else this.setState("failed", reason ?? "You ended the call before the task was finished.");
    this.stop();
    this.publish({ type: "snapshot", data: this.snapshot() });
  }

  private stop() {
    this.cancelled = true;
    this.wake?.();
    this.timers.forEach((t) => clearTimeout(t));
    (["agent", "callee", "you"] as const).forEach((w) => this.activity(w, false));
  }

  private recordOutcome(outcome: Outcome) {
    this.call.outcome = outcome;
    this.publish({ type: "outcome", data: outcome });
    if (this.call.state === "in_progress" || this.call.state === "waiting_on_user") this.setState("wrapping_up");
  }

  // ---- API ---------------------------------------------------------------------

  reply(questionId: string, answer: string): boolean {
    const q = this.call.pending_question;
    if (!q || q.question_id !== questionId || this.terminal) return false;
    this.call.pending_question = null;
    this.transcript(newId("u_"), "user", answer, true, { via: "answer" });
    this.publish({ type: "question_closed", data: { question_id: q.question_id } });
    if (!q.timed_out && this.answer) {
      this.answer(answer);
      if (this.call.state === "waiting_on_user") this.setState(this.stateBeforeQuestion);
    } else {
      void this.speak("agent", `Good news, ${this.call.task.user_name} just got back to me: ${answer}.`).catch(() => undefined);
    }
    return true;
  }

  say(text: string, voiceId: string | null): string {
    if (!["in_progress", "waiting_on_user", "wrapping_up"].includes(this.call.state)) {
      throw new Error("The call isn't connected right now.");
    }
    const lineId = newId("u_");
    this.transcript(lineId, "user", text, true, { via: "typed", status: "queued", voice: voiceName(voiceId ?? this.call.task.my_voice_id ?? DEFAULT_MY_VOICE) });
    if (this.call.mode === "direct") {
      this.typed.push({ lineId, text });
      this.wake?.();
    } else {
      void this.interject(lineId, text).catch(() => undefined);
    }
    return lineId;
  }

  setMode(mode: CallMode) {
    if (this.call.mode === mode || this.terminal) return;
    this.call.mode = mode;
    if (mode === "direct") {
      const q = this.call.pending_question;
      if (q && !q.timed_out && this.answer) {
        this.takenOver = true;
        this.answer(null);
      }
      if (q) {
        this.call.pending_question = null;
        this.publish({ type: "question_closed", data: { question_id: q.question_id } });
        if (this.call.state === "waiting_on_user") this.setState(this.stateBeforeQuestion);
      }
    } else {
      // Anything typed but not yet said goes out as the agent takes over.
      for (const { lineId, text } of this.typed.splice(0)) void this.voiceTyped(lineId, text).catch(() => undefined);
    }
    this.publish({ type: "mode", data: { mode } });
    this.wake?.();
  }

  hangup() {
    this.finish("You ended the call before the task was finished.");
  }

  // ---- timing ------------------------------------------------------------------

  private pause(seconds: number): Promise<void> {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        if (this.cancelled) reject(new Cancelled());
        else resolve();
      }, (seconds * 1000) / this.speed);
      this.timers.add(t);
    });
  }

  private voiceFor(speaker: Speaker) {
    const task = this.call.task;
    if (speaker === "callee") return RECEPTIONIST_VOICE;
    if (speaker === "user") return task.my_voice_id ?? DEFAULT_MY_VOICE;
    return task.agent_voice_id ?? DEFAULT_AGENT_VOICE;
  }

  private announce(id: string, speaker: Speaker, text: string) {
    this.publish({ type: "sim_speech", data: { id, speaker, text, voice_id: this.voiceFor(speaker) } });
  }

  // ---- speaking ----------------------------------------------------------------

  private speak(speaker: "agent" | "callee", text: string): Promise<string> {
    return this.line.run(async () => {
      if (this.terminal) return "";
      const id = newId("sim_");
      const words = text.split(/\s+/);
      let said = text;
      this.announce(id, speaker, text);
      this.activity(speaker, true);
      if (speaker === "callee") {
        this.transcript(id, "callee", "", false);
        await this.pause(0.4);
      }
      for (let i = 1; i <= words.length; i++) {
        if (speaker === "agent" && this.call.mode === "direct") {
          said = words.slice(0, i - 1).join(" ");
          said = said ? `${said}…` : "";
          break;
        }
        this.transcript(id, speaker, words.slice(0, i).join(" "), false);
        await this.pause(WORD_S);
      }
      this.transcript(id, speaker, said, true);
      this.activity(speaker, false);
      if (speaker === "callee") this.lastCalleeLine = text;
      await this.pause(0.5);
      return said;
    });
  }

  private voiceTyped(lineId: string, text: string): Promise<void> {
    return this.line.run(async () => {
      if (this.terminal) return;
      this.announce(lineId, "user", text);
      this.lineStatus(lineId, "speaking");
      this.activity("you", true);
      await this.pause(WORD_S * 1.1 * text.split(/\s+/).length + 0.4);
      this.activity("you", false);
      this.lineStatus(lineId, "spoken");
      await this.pause(0.4);
    });
  }

  private async interject(lineId: string, text: string) {
    await this.voiceTyped(lineId, text);
    if (REPEAT.test(text) || SLOWER.test(text) || HOLD.test(text)) await this.receptionist(text, false);
  }

  // ---- the conversation ------------------------------------------------------------

  private async run() {
    const task = this.call.task;
    try {
      await this.pause(1.2);
      this.setState("ringing");
      if (task.to_number.replace(/\D/g, "").endsWith("0000")) {
        await this.pause(6);
        this.call.ended_at = now();
        this.setState("no_answer", "No one picked up after 30 seconds.");
        this.stop();
        this.publish({ type: "snapshot", data: this.snapshot() });
        return;
      }
      await this.pause(3);
      this.call.answered_at = now();
      this.setState("in_progress");
      const limit = setTimeout(() => this.finish("The call reached the 5-minute limit before the task was finished."), 300_000);
      this.timers.add(limit);
      await this.speak("callee", `Good afternoon, ${task.callee_name}, this is Maria. How can I help you?`);

      while (this.stage !== "done" && !this.terminal) {
        if (this.call.mode === "agent") {
          const said = await this.agentTurn();
          if (said) await this.receptionist(said, true);
        } else {
          const text = await this.typedTurn();
          if (text) await this.receptionist(text, false);
        }
      }
      if (!this.terminal) {
        await this.pause(0.8);
        this.finish();
      }
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    }
  }

  private async typedTurn(): Promise<string | null> {
    let next = this.typed.shift();
    if (!next) {
      await new Promise<void>((resolve) => {
        this.wake = () => {
          this.wake = null;
          resolve();
        };
      });
      if (this.cancelled) throw new Cancelled();
      if (this.call.mode !== "direct") return null;
      next = this.typed.shift();
      if (!next) return null;
    }
    await this.voiceTyped(next.lineId, next.text);
    return next.text;
  }

  private async agentTurn(): Promise<string | null> {
    const task = this.call.task;
    const user = task.user_name;
    if (this.stage === "greet") {
      const spokeAlready = this.call.transcript.some((t) => t.speaker === "user");
      const intro = spokeAlready
        ? `Hi, I'm an AI assistant helping ${user} with this call.`
        : `Hi, I'm an AI assistant calling on behalf of ${user}.`;
      const goal = task.goal.trim().replace(/\.$/, "") || "booking an appointment";
      return this.speak("agent", `${intro} I'm calling about this: ${goal}.`);
    }
    if (this.stage === "dob") {
      const dob = Object.entries(task.facts).find(([k]) => /birth|dob/i.test(k))?.[1];
      if (dob) return this.speak("agent", `Of course, it's ${dob}.`);
      await this.speak("agent", "One moment, let me check.");
      const answer = await this.ask("They're asking for your date of birth. What should I tell them?", []);
      return answer ? this.speak("agent", `Thanks for waiting. It's ${answer}.`) : null;
    }
    if (this.stage === "slots") {
      await this.speak("agent", "One moment, let me check.");
      const answer = await this.ask("Which appointment works better?", this.slots.map((s) => s.label));
      return answer ? this.speak("agent", `${answer} works. Please book that one.`) : null;
    }
    if (this.stage === "confirm") {
      return this.speak("agent", `Just to confirm: ${this.booked}, for ${user}, confirmation number R C 4 8 2 1. Is that right?`);
    }
    return this.speak("agent", "No, that's everything. Thank you so much, goodbye!");
  }

  private async ask(question: string, options: string[]): Promise<string | null> {
    if (this.call.mode === "direct") return null;
    const q: Question = { question_id: newId("q_"), question, options, timeout_s: ASK_TIMEOUT_S, asked_at: now(), timed_out: false };
    this.call.pending_question = q;
    if (this.call.state !== "waiting_on_user") this.stateBeforeQuestion = this.call.state;
    this.takenOver = false;
    this.setState("waiting_on_user");
    this.publish({ type: "ask_user", data: q });
    const answer = await new Promise<string | null>((resolve) => {
      const t = setTimeout(() => resolve(null), ASK_TIMEOUT_S * 1000);
      this.timers.add(t);
      this.answer = (value) => {
        clearTimeout(t);
        this.answer = null;
        resolve(value);
      };
    });
    if (this.cancelled) throw new Cancelled();
    if (answer !== null) return answer;
    if (this.takenOver || this.isDirect()) return null; // they're typing now
    q.timed_out = true;
    this.call.pending_question = { ...q };
    if (this.call.state === "waiting_on_user") this.setState(this.stateBeforeQuestion);
    this.publish({ type: "ask_user", data: { ...q } });
    await this.giveUp();
    return null;
  }

  private async giveUp() {
    const user = this.call.task.user_name;
    await this.speak("agent", `I'm sorry, I need to check with ${user} first. Could we call you back?`);
    await this.speak("callee", "Of course. Just call back whenever you're ready.");
    this.recordOutcome({
      status: "partial",
      summary: "You didn't answer in time, so the agent told them you'd call back.",
      details: { contact_name: "Maria", notes: "Call back to finish booking." },
    });
    this.stage = "done";
  }

  private async receptionist(line: string, fromAgent: boolean) {
    const text = line.toLowerCase();
    const slotList = `${this.slots[0].label}, or ${this.slots[1].label}`;
    if (REPEAT.test(text)) return void (await this.speak("callee", `Sure. ${this.lastCalleeLine}`));
    if (SLOWER.test(text)) return void (await this.speak("callee", `Sorry about that! ${this.lastCalleeLine}`));
    if (HOLD.test(text) && !fromAgent) return void (await this.speak("callee", "Sure, take your time."));

    if (this.stage === "greet") {
      if (fromAgent || BOOKING.test(text)) {
        this.stage = "dob";
        await this.speak("callee", "Sure, I can help with that. Can I get the patient's date of birth?");
      } else {
        await this.speak("callee", "No problem at all, thanks for letting me know. How can I help you today?");
      }
    } else if (this.stage === "dob") {
      if (fromAgent || DATE.test(text)) {
        this.stage = "slots";
        await this.speak("callee", `Thanks, I found you. I have two openings: ${slotList}. Which works better?`);
      } else {
        await this.speak("callee", "Sorry, I just need the patient's date of birth to look them up.");
      }
    } else if (this.stage === "slots") {
      const slot = this.slots.find((s) => s.pattern.test(text));
      if (!slot) return void (await this.speak("callee", `I only have those two right now: ${slotList}.`));
      await this.speak("callee", `You're all set for ${slot.label}. Your confirmation number is R C 4 8 2 1.`);
      const task = this.call.task;
      this.recordOutcome({
        status: "success",
        summary: `Booked ${slot.label} at ${task.callee_name}.`,
        details: {
          date: slot.date,
          time: slot.time,
          confirmation_number: "RC-4821",
          location: task.callee_name,
          contact_name: "Maria",
        },
      });
      this.booked = slot.label;
      this.stage = "confirm";
    } else if (this.stage === "confirm") {
      this.stage = "anything_else";
      await this.speak("callee", "Perfect. Is there anything else I can help you with?");
    } else if (this.stage === "anything_else") {
      if (REMINDER.test(text)) {
        await this.speak("callee", "Sure, I've set up a text reminder for the day before. Anything else?");
      } else if (DONE.test(text) || fromAgent) {
        this.stage = "done";
        await this.speak("callee", "Great. Have a wonderful day! Bye now.");
      } else {
        await this.speak("callee", "Got it, I've made a note of that. Anything else I can help with?");
      }
    }
  }
}

// ---- the "server" --------------------------------------------------------------------

const calls = new Map<string, LocalCall>();

export const localEngine = {
  speed: 1,
  create(task: CallTask): string {
    const call = new LocalCall(task, this.speed);
    calls.set(call.call.id, call);
    return call.call.id;
  },
  get(id: string): LocalCall {
    const call = calls.get(id);
    if (!call) throw new Error("No call with that id.");
    return call;
  },
  subscribe(id: string, listener: (e: FeedEvent) => void): () => void {
    const call = calls.get(id);
    if (!call) {
      listener({ type: "error", data: { message: "No call with that id." } });
      return () => undefined;
    }
    call.listeners.add(listener);
    listener({ type: "snapshot", data: call.snapshot() });
    return () => call.listeners.delete(listener);
  },
};
