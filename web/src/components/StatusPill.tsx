import type { CallState } from "../types";

export const STATE_LABELS: Record<CallState, string> = {
  dialing: "Dialing",
  ringing: "Ringing",
  in_progress: "On the call",
  waiting_on_user: "Needs your decision",
  wrapping_up: "Confirming details",
  completed: "Completed",
  no_answer: "No answer",
  failed: "Call failed",
};

const STYLES: Record<CallState, { pill: string; dot: string }> = {
  dialing: { pill: "bg-surface-2 text-ink-2 border-line", dot: "bg-ink-3" },
  ringing: { pill: "bg-accent-soft text-accent-ink border-accent/40", dot: "bg-accent animate-pulse" },
  in_progress: { pill: "bg-ok-soft text-ok-ink border-ok-line", dot: "bg-ok animate-pulse" },
  waiting_on_user: { pill: "bg-warn-soft text-warn-ink border-warn-line", dot: "bg-warn animate-pulse" },
  wrapping_up: { pill: "bg-accent-soft text-accent-ink border-accent/40", dot: "bg-accent" },
  completed: { pill: "bg-ok-soft text-ok-ink border-ok-line", dot: "bg-ok" },
  no_answer: { pill: "bg-surface-2 text-ink-2 border-line", dot: "bg-ink-3" },
  failed: { pill: "bg-bad-soft text-bad-ink border-bad-line", dot: "bg-bad" },
};

/** The state lives in a polite live region so screen readers hear each change. */
export function StatusPill({ state }: { state: CallState }) {
  const style = STYLES[state];
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold whitespace-nowrap ${style.pill}`}
      >
        <span className={`size-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
        <span className="sr-only">Call status: </span>
        {STATE_LABELS[state]}
      </span>
    </div>
  );
}
