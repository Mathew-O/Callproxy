import { BellRing, Hand, Send } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { btn, input } from "../lib/ui";
import type { Question } from "../types";

interface Props {
  question: Question;
  calleeName: string;
  clockOffset: number;
  onAnswer: (answer: string) => Promise<void>;
  /** Skip the agent and talk to them directly instead. */
  onTakeOver?: () => void;
}

/**
 * Slides up when the agent calls ask_user. It takes focus so keyboard and screen reader
 * users land on it, options are big buttons (also 1-9 on the keyboard), and there's
 * always a free-text answer.
 */
export function DecisionCard({ question, calleeName, clockOffset, onAnswer, onTakeOver }: Props) {
  const firstOption = useRef<HTMLButtonElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deadline = question.asked_at + question.timeout_s - clockOffset;
  const secondsLeft = useSecondsLeft(deadline);
  const { options } = question;

  useEffect(() => {
    (firstOption.current ?? textInput.current)?.focus();
    setText("");
    setError(null);
  }, [question.question_id]);

  const send = async (answer: string) => {
    if (sending || !answer.trim()) return;
    setSending(answer);
    setError(null);
    try {
      await onAnswer(answer.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send your answer.");
      setSending(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        e.preventDefault();
        void send(options[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="decision-title"
      aria-describedby="decision-question"
      className="relative shrink-0 animate-slide-up border-t-2 border-warn-line bg-warn-soft shadow-[0_-12px_32px_-12px_rgb(0_0_0/0.25)]"
    >
      {!question.timed_out && secondsLeft !== null && (
        <div className="absolute inset-x-0 top-0 h-1 bg-warn-line/25" aria-hidden="true">
          <div
            className="h-full bg-warn transition-[width] duration-300 ease-linear"
            style={{ width: `${Math.min(100, (secondsLeft / question.timeout_s) * 100)}%` }}
          />
        </div>
      )}
      <div className="mx-auto max-h-[62dvh] max-w-4xl overflow-y-auto px-4 pt-5 pb-5 sm:px-6 [@media(max-height:34rem)]:max-h-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="decision-title" className="flex items-center gap-2 text-sm font-extrabold tracking-wide text-warn-ink uppercase">
            <span className="grid size-7 place-items-center rounded-full bg-warn text-[#1f1300]" aria-hidden="true">
              <BellRing className="size-4" />
            </span>
            Decision needed · {calleeName} is waiting
          </h2>
          {!question.timed_out && secondsLeft !== null && (
            <span className="font-mono text-sm font-bold text-warn-ink" aria-hidden="true">
              {secondsLeft}s
            </span>
          )}
        </div>
        <p id="decision-question" className="mt-3 text-2xl leading-tight font-extrabold text-ink sm:text-3xl">
          {question.question}
        </p>
        {question.timed_out && (
          <p className="mt-2 text-base text-warn-ink">
            The agent told {calleeName} you'd get back to them. You can still answer and it will pass it on.
          </p>
        )}

        {options.length > 0 && (
          <div role="group" aria-label="Options" className="mt-5 grid gap-3 sm:grid-cols-2">
            {options.map((option, i) => (
              <button
                key={option}
                ref={i === 0 ? firstOption : undefined}
                type="button"
                disabled={sending !== null}
                onClick={() => void send(option)}
                aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                className="group flex min-h-18 cursor-pointer items-center gap-4 rounded-2xl border-2 border-line-strong bg-surface px-4 py-3 text-left text-xl font-bold text-ink shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-card disabled:opacity-60"
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft font-mono text-lg text-accent-ink group-hover:bg-accent group-hover:text-on-accent"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span>{sending === option ? "Sending…" : option}</span>
              </button>
            ))}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-4">
          <label htmlFor="decision-text" className="mb-1.5 block text-base font-bold text-ink">
            {options.length ? "Or type something else" : "Your answer"}
          </label>
          <div className="flex gap-2">
            <input
              id="decision-text"
              ref={textInput}
              className={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={sending !== null}
              autoComplete="off"
              placeholder={options.length ? "e.g. Anything next week instead?" : "Type your answer"}
            />
            <button type="submit" className={btn.primary} disabled={sending !== null || !text.trim()}>
              <Send className="size-5" aria-hidden="true" />
              Send
            </button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {options.length > 0 && (
          <p className="hidden text-sm text-ink-2 sm:block">
            Tip: press <kbd className="rounded border border-line-strong bg-surface px-1.5 font-mono">1</kbd>–
            <kbd className="rounded border border-line-strong bg-surface px-1.5 font-mono">{Math.min(options.length, 9)}</kbd> to
            pick an option.
          </p>
        )}
        {onTakeOver && (
          <button
            type="button"
            onClick={onTakeOver}
            className="ml-auto inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-bold text-warn-ink underline-offset-4 hover:underline"
          >
            <Hand className="size-4" aria-hidden="true" />
            Talk to {calleeName} yourself instead
          </button>
        )}
        </div>
        {error && (
          <p role="alert" className="mt-2 font-bold text-bad-ink">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function useSecondsLeft(deadlineSeconds: number): number | null {
  const compute = () => Math.max(0, Math.ceil(deadlineSeconds - Date.now() / 1000));
  const [left, setLeft] = useState<number | null>(compute);
  useEffect(() => {
    setLeft(compute());
    const id = window.setInterval(() => setLeft(compute()), 250);
    return () => window.clearInterval(id);
  }, [deadlineSeconds]);
  return left;
}
