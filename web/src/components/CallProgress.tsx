import { Check } from "lucide-react";
import type { CallState } from "../types";

const STEPS: { label: string; states: CallState[] }[] = [
  { label: "Dialing", states: ["dialing"] },
  { label: "Ringing", states: ["ringing"] },
  { label: "Talking", states: ["in_progress", "waiting_on_user"] },
  { label: "Confirming", states: ["wrapping_up"] },
  { label: "Done", states: ["completed"] },
];

/** Where the call is in its lifecycle, so nobody has to guess what happens next. */
export function CallProgress({ state }: { state: CallState }) {
  const current = STEPS.findIndex((s) => s.states.includes(state));
  return (
    <ol aria-label="Call progress" className="flex flex-wrap items-center justify-center gap-1.5 text-sm">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step.label}
            aria-current={active ? "step" : undefined}
            className="flex items-center gap-1.5"
          >
            {i > 0 && <span className={`h-0.5 w-4 rounded-full sm:w-6 ${done || active ? "bg-accent" : "bg-line"}`} aria-hidden="true" />}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-bold whitespace-nowrap ${
                active ? "bg-accent-soft text-accent-ink" : done ? "text-ink-2" : "text-ink-3"
              }`}
            >
              <span
                className={`grid size-4 place-items-center rounded-full text-[0.6rem] ${
                  done ? "bg-accent text-on-accent" : active ? "border-2 border-accent" : "border-2 border-line-strong"
                }`}
                aria-hidden="true"
              >
                {done && <Check className="size-3" strokeWidth={3.5} />}
              </span>
              {step.label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
