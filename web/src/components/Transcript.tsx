import { AlertTriangle, Check, Clock } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { formatDuration } from "../lib/format";
import type { Speaker, TranscriptTurn } from "../types";
import { SpeakingBars } from "./Avatar";

interface Props {
  turns: TranscriptTurn[];
  calleeName: string;
  /** When the call was answered (server clock), for per-line timestamps. */
  startedAt?: number | null;
  /** Live transcripts announce new lines to screen readers and stick to the bottom. */
  live?: boolean;
  empty?: ReactNode;
  /** Changes when something next to the transcript opens or closes (the decision card),
   *  so the view can re-pin in the same frame rather than waiting on a ResizeObserver. */
  pinKey?: string | null;
  /** Rendered under the newest line, inside the scrolling area (the speaking orb on phones). */
  after?: ReactNode;
}

const BUBBLE: Record<Speaker, string> = {
  agent: "bg-accent text-on-accent rounded-br-md",
  callee: "bg-surface text-ink border border-line rounded-bl-md shadow-sm",
  user: "bg-warn-soft text-warn-ink border border-warn-line rounded-br-md",
};
const PARTIAL = "bg-surface-2 text-ink-2 border border-dashed border-line-strong";
const LABEL_DOT: Record<Speaker, string> = { agent: "bg-accent", callee: "bg-ok", user: "bg-warn" };

export function Transcript({ turns, calleeName, startedAt, live = false, empty, pinKey, after }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const userScrollAt = useRef(0);

  const labels: Record<Speaker, string> = { agent: "CallProxy agent", callee: calleeName, user: "You" };
  const labelFor = (turn: TranscriptTurn) => {
    if (turn.via === "typed") return turn.voice ? `You · ${turn.voice}'s voice` : "You (typed)";
    if (turn.via === "answer") return "You chose";
    return labels[turn.speaker];
  };

  // Stay pinned to the newest line unless the reader scrolled up to look at something.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (live && el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns, live, pinKey]);

  useEffect(() => {
    const el = scroller.current;
    if (!live || !el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [live]);

  // Layout changes (new lines, the composer growing, the decision card) fire scroll events
  // too, so only a scroll the reader started can unpin the view. Reaching the bottom re-pins.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom) pinned.current = true;
    else if (Date.now() - userScrollAt.current < 1000) pinned.current = false;
  };
  const markUserScroll = () => {
    userScrollAt.current = Date.now();
  };

  const list = (
    <ol aria-label="Call transcript" className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
      {turns.map((turn) => {
        const right = turn.speaker !== "callee";
        const stamp = startedAt ? formatDuration(turn.ts - startedAt) : null;
        return (
          <li key={turn.id} className={`flex animate-fade-in ${right ? "justify-end" : "justify-start"}`}>
            <div className={`flex max-w-[88%] flex-col sm:max-w-[80%] ${right ? "items-end" : "items-start"}`}>
              <span className="mb-1.5 flex items-center gap-2 px-1 text-sm font-bold text-ink-2" aria-hidden="true">
                <span className={`size-2 rounded-full ${LABEL_DOT[turn.speaker]}`} />
                {labelFor(turn)}
                {stamp && <span className="font-mono font-normal text-ink-3">{stamp}</span>}
              </span>
              <p
                className={`caption-text rounded-3xl px-4 py-3 break-words sm:px-5 ${
                  turn.final ? BUBBLE[turn.speaker] : PARTIAL
                }`}
              >
                {turn.final ? (
                  // A fresh node once final, so the live region announces the finished line once.
                  <span key="final">
                    <span className="sr-only">{labelFor(turn)}: </span>
                    {turn.text}
                  </span>
                ) : (
                  <span key="partial" aria-hidden="true">
                    {turn.text || <TypingDots />}
                  </span>
                )}
              </p>
              {turn.via === "typed" && turn.status && <LineStatus status={turn.status} />}
            </div>
          </li>
        );
      })}
    </ol>
  );

  if (!live) return list;
  return (
    // Focusable so keyboard users can scroll back through the conversation.
    <div
      ref={scroller}
      onScroll={onScroll}
      onWheel={markUserScroll}
      onTouchMove={markUserScroll}
      onPointerDown={markUserScroll}
      onKeyDown={markUserScroll}
      tabIndex={0}
      role="region"
      aria-label="Live transcript"
      className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-offset-[-3px] [@media(max-height:34rem)]:overflow-visible"
    >
      {turns.length === 0 && empty}
      <div role="log" aria-live="polite" aria-relevant="additions">
        {list}
      </div>
      {after}
    </div>
  );
}

/** Where a typed line is: waiting its turn, being spoken, or said. */
function LineStatus({ status }: { status: NonNullable<TranscriptTurn["status"]> }) {
  const view = {
    queued: { icon: <Clock className="size-3.5" />, text: "Waiting to speak", tone: "text-ink-2" },
    speaking: { icon: <SpeakingBars tone="ok" />, text: "Speaking now", tone: "text-ok-ink" },
    spoken: { icon: <Check className="size-3.5" strokeWidth={3} />, text: "Said on the call", tone: "text-ink-2" },
    failed: { icon: <AlertTriangle className="size-3.5" />, text: "Couldn't voice this line", tone: "text-bad-ink" },
  }[status];
  return (
    <span className={`mt-1.5 flex items-center gap-1.5 px-1 text-xs font-bold ${view.tone}`} aria-hidden={status !== "failed"}>
      {view.icon}
      {view.text}
    </span>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1.5 py-2" title="Speaking">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-2 animate-bounce rounded-full bg-ink-3"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
