import { useEffect, useRef } from "react";
import { DEMO_SCRIPT } from "../lib/demo";
import { isTerminal, type Call, type CallMode } from "../types";

interface Driver {
  call: Call;
  active: boolean;
  introduction: string;
  setDraft: (text: string) => void;
  say: (text: string) => Promise<void>;
  setMode: (mode: CallMode) => Promise<void>;
  answer: (questionId: string, answer: string) => Promise<void>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The hands-free demo: types Jordan's side of the call into the real composer, keystroke
 * by keystroke, each time the other side finishes a line. When they offer two slots it
 * hands the call to the agent, then picks the first option on the decision card. It keys
 * off what's said, so it follows a live judge reading the cue card as well as the
 * practice receptionist.
 */
export function useDemoDriver({ call, active, introduction, setDraft, say, setMode, answer }: Driver) {
  const step = useRef(0);
  const busy = useRef(false);
  const lastHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!active || busy.current || isTerminal(call.state)) return;

    const run = (action: () => Promise<void>) => {
      busy.current = true;
      step.current += 1;
      action()
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
        });
    };
    const typeOut = async (line: string) => {
      await wait(900);
      for (let i = 1; i <= line.length; i++) {
        setDraft(line.slice(0, i));
        await wait(22 + Math.random() * 38);
      }
      await wait(450);
      await say(line);
      setDraft("");
    };

    const question = call.pending_question;
    if (question && !question.timed_out) {
      const pick = question.options[0] ?? "Yes, that's right.";
      busy.current = true;
      wait(call.simulated ? 3200 : 9000) // live: leave the presenter time to tap it themselves
        .then(() => answer(question.question_id, pick))
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
        });
      return;
    }

    const typed = call.transcript.filter((t) => t.via === "typed");
    if (call.mode !== "direct" || typed.some((t) => t.status === "queued" || t.status === "speaking")) return;
    const finals = call.transcript.filter((t) => t.final);
    const last = finals[finals.length - 1];
    // React once to each finished line from the other side.
    if (!last || last.speaker !== "callee" || call.speaking.callee || last.id === lastHandled.current) return;
    const heard = last.text;

    if (step.current === 0) {
      lastHandled.current = last.id;
      run(() => typeOut(introduction));
    } else if (step.current === 1) {
      lastHandled.current = last.id;
      // They might ask for the birthday straight away; otherwise ask to book.
      run(() => typeOut(DEMO_SCRIPT.asksBirthday.test(heard) ? DEMO_SCRIPT.birthday : DEMO_SCRIPT.booking));
      if (DEMO_SCRIPT.asksBirthday.test(heard)) step.current += 1;
    } else if (step.current === 2 && DEMO_SCRIPT.asksBirthday.test(heard)) {
      lastHandled.current = last.id;
      run(() => typeOut(DEMO_SCRIPT.birthday));
    } else if (step.current >= 2 && step.current <= 3 && DEMO_SCRIPT.offersTwo.test(heard)) {
      lastHandled.current = last.id;
      step.current = 3;
      run(async () => {
        await wait(1800);
        await setMode("agent"); // the agent takes it from here and asks which slot
      });
    }
  }, [call, active, introduction, setDraft, say, setMode, answer]);
}
