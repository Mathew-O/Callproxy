import { CalendarPlus, Check, CircleAlert, CircleX, Copy, Keyboard, MessageSquareText, Phone, Timer, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TopBar } from "../components/TopBar";
import { Transcript } from "../components/Transcript";
import { detailLabel, detailValue, formatDuration, orderedDetails, parseDate, parseTime } from "../lib/format";
import { buildIcs, canAddToCalendar, downloadIcs } from "../lib/ics";
import { goHome } from "../lib/nav";
import { btn, card } from "../lib/ui";
import type { Call, Outcome } from "../types";

const RESULT: Record<Outcome["status"], { label: string; badge: string; icon: string; Icon: typeof Check }> = {
  success: { label: "All set", badge: "bg-ok-soft text-ok-ink border-ok-line", icon: "bg-ok-soft text-ok-ink border border-ok-line", Icon: Check },
  partial: { label: "Partly done", badge: "bg-warn-soft text-warn-ink border-warn-line", icon: "bg-warn-soft text-warn-ink border border-warn-line", Icon: CircleAlert },
  failed: { label: "Not done", badge: "bg-bad-soft text-bad-ink border-bad-line", icon: "bg-bad-soft text-bad-ink border border-bad-line", Icon: CircleX },
};
const VOICE = { simulator: "Practice", openai: "Live · OpenAI agent", elevenlabs: "Live · ElevenLabs" };

export function Summary({ call }: { call: Call }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);
  const outcome = call.outcome;
  const { task } = call;

  // Land focus on the result so screen reader users hear that the call is over.
  useEffect(() => heading.current?.focus(), []);

  // A call the user typed themselves can end without an agent-recorded outcome.
  const result = outcome
    ? RESULT[outcome.status]
    : { label: "Call ended", badge: "bg-surface-2 text-ink-2 border-line", icon: "bg-accent-soft text-accent-ink border border-accent/40", Icon: MessageSquareText };
  const typed = call.transcript.filter((t) => t.via === "typed");
  const voicesUsed = [...new Set(typed.map((t) => t.voice).filter(Boolean))].join(" & ");
  const details = outcome ? orderedDetails(outcome.details).filter(([k]) => !(k === "date" || k === "time")) : [];
  const calendarReady = outcome ? canAddToCalendar(outcome.details) : false;
  const length = call.answered_at && call.ended_at ? formatDuration(call.ended_at - call.answered_at) : null;
  const gaps = call.response_gaps_ms;
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000 : null;

  const addToCalendar = () => {
    if (!outcome) return;
    const d = outcome.details;
    const ics = buildIcs({
      uid: call.id,
      title: `Appointment: ${task.callee_name}`,
      date: d.date,
      time: d.time,
      durationMinutes: Number(d.duration_minutes) || 60,
      location: d.location || task.callee_name,
      description: [
        d.confirmation_number && `Confirmation #: ${d.confirmation_number}`,
        d.contact_name && `Booked with ${d.contact_name}`,
        "Booked by CallProxy",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    downloadIcs(`${task.callee_name.replace(/[^\w]+/g, "-").toLowerCase() || "appointment"}.ics`, ics);
  };

  const copySummary = async () => {
    const speaker = (s: string) => (s === "callee" ? task.callee_name : s === "agent" ? "Agent" : "You");
    const lines = outcome
      ? [outcome.summary, ...orderedDetails(outcome.details).map(([k, v]) => `${detailLabel(k)}: ${detailValue(k, v)}`)]
      : call.transcript.filter((t) => t.final).map((t) => `${speaker(t.speaker)}: ${t.text}`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard can be blocked; the text is on screen anyway */
    }
  };

  return (
    <div className="min-h-dvh pb-20">
      <TopBar>
        <button className={btn.secondary} onClick={goHome}>
          <Phone className="size-5" aria-hidden="true" />
          New call
        </button>
      </TopBar>

      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-4 sm:px-6">
        <section className={`${card} overflow-hidden`} aria-labelledby="summary-title">
          <div className="p-6 sm:p-9">
            <div className="flex items-center gap-3">
              <span className={`grid size-12 place-items-center rounded-2xl ${result.icon}`} aria-hidden="true">
                <result.Icon className="size-7" strokeWidth={3} />
              </span>
              <div>
                <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-bold ${result.badge}`}>{result.label}</span>
                <p className="mt-1 text-sm font-bold text-ink-2">Call with {task.callee_name}</p>
              </div>
            </div>
            <h1
              id="summary-title"
              ref={heading}
              tabIndex={-1}
              className="mt-5 text-3xl leading-tight font-extrabold tracking-tight text-ink focus:outline-none sm:text-4xl"
            >
              {outcome?.summary || `You talked with ${task.callee_name}${length ? ` for ${length}` : ""}.`}
            </h1>
          </div>

          {outcome && (outcome.details.date || outcome.details.time) && <WhenBlock details={outcome.details} />}

          {details.length > 0 && (
            <dl className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
              {details.map(([key, value]) => (
                <div key={key} className="bg-surface px-6 py-4 sm:px-9 sm:odd:last:col-span-2">
                  <dt className="text-sm font-bold text-ink-2">{detailLabel(key)}</dt>
                  <dd
                    className={`mt-1 text-xl font-bold break-words text-ink ${key === "confirmation_number" ? "font-mono tracking-wide" : ""}`}
                  >
                    {detailValue(key, value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line p-6 sm:px-9">
            {calendarReady && (
              <button className={btn.primary} onClick={addToCalendar}>
                <CalendarPlus className="size-5" aria-hidden="true" />
                Add to calendar
              </button>
            )}
            {(outcome || call.transcript.length > 0) && (
              <button className={btn.secondary} onClick={copySummary}>
                {copied ? <Check className="size-5" aria-hidden="true" /> : <Copy className="size-5" aria-hidden="true" />}
                {copied ? "Copied" : outcome ? "Copy details" : "Copy transcript"}
              </button>
            )}
            <span className="sr-only" role="status">
              {copied ? "Details copied" : ""}
            </span>
          </div>
        </section>

        <ul className="grid gap-3 sm:grid-cols-3">
          {length && <Stat icon={<Timer className="size-5" />} label="Call length" value={length} />}
          {avgGap !== null && <Stat icon={<Zap className="size-5" />} label="Agent reply time" value={`${avgGap.toFixed(1)} s`} />}
          {typed.length > 0 && (
            <Stat
              icon={<Keyboard className="size-5" />}
              label={voicesUsed ? `Typed, read by ${voicesUsed}` : "Typed by you"}
              value={`${typed.length} ${typed.length === 1 ? "line" : "lines"}`}
            />
          )}
          <Stat icon={<Phone className="size-5" />} label="Call" value={VOICE[call.voice_provider] ?? "Live call"} />
        </ul>

        <details className={`${card} group`} open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-5 text-xl font-extrabold text-ink sm:px-9 [&::-webkit-details-marker]:hidden">
            Full transcript
            <span className="text-sm font-bold text-ink-2 group-open:hidden">Show</span>
            <span className="hidden text-sm font-bold text-ink-2 group-open:inline">Hide</span>
          </summary>
          <div className="border-t border-line">
            {call.transcript.length ? (
              <Transcript turns={call.transcript} calleeName={task.callee_name} startedAt={call.answered_at} />
            ) : (
              <p className="px-6 py-5 text-ink-2">Nothing was said on this call.</p>
            )}
          </div>
        </details>
      </main>
    </div>
  );
}

/** The appointment itself, big: the thing people glance back at. */
function WhenBlock({ details }: { details: Record<string, string> }) {
  const d = parseDate(details.date);
  const t = parseTime(details.time);
  const date = d ? new Date(d.y, d.m - 1, d.d) : null;
  return (
    <div className="flex flex-wrap items-center gap-5 border-t border-line bg-accent-soft px-6 py-5 sm:px-9">
      {date ? (
        <div className="grid w-20 shrink-0 overflow-hidden rounded-2xl bg-surface text-center shadow-sm" aria-hidden="true">
          <span className="bg-accent py-1 text-xs font-extrabold tracking-widest text-on-accent uppercase">
            {date.toLocaleDateString("en-US", { month: "short" })}
          </span>
          <span className="py-1.5 text-3xl font-extrabold text-ink">{date.getDate()}</span>
        </div>
      ) : null}
      <div>
        <p className="text-sm font-bold text-accent-ink">When</p>
        <p className="text-2xl font-extrabold text-ink">
          {[details.date && detailValue("date", details.date), details.time && (t ? detailValue("time", details.time) : details.time)]
            .filter(Boolean)
            .join(" at ")}
        </p>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <li className={`${card} flex items-center gap-3 rounded-2xl px-4 py-3`}>
      <span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-accent-ink" aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-bold text-ink-2">{label}</span>
        <span className="block text-lg font-extrabold text-ink">{value}</span>
      </span>
    </li>
  );
}
