import { PencilLine, PhoneMissed, PhoneOff, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { TopBar } from "../components/TopBar";
import { Transcript } from "../components/Transcript";
import { formFromTask, saveDraft } from "../lib/draft";
import { goHome, goToCall } from "../lib/nav";
import { btn, card } from "../lib/ui";
import type { Call } from "../types";

/** No answer, or a call that ended before an outcome: say what happened and offer a retry. */
export function EndedEarly({ call }: { call: Call }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noAnswer = call.state === "no_answer";
  const Icon = noAnswer ? PhoneMissed : PhoneOff;

  useEffect(() => heading.current?.focus(), []);

  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const { call_id } = await api.createCall(call.task, call.simulated);
      goToCall(call_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't place the call.");
      setRetrying(false);
    }
  };

  const edit = () => {
    saveDraft(formFromTask(call.task));
    goHome();
  };

  return (
    <div className="min-h-dvh pb-20">
      <TopBar />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-4 sm:px-6">
        <section className={`${card} p-6 sm:p-9`}>
          <span
            className={`grid size-14 place-items-center rounded-2xl border ${
              noAnswer ? "border-line bg-surface-2 text-ink-2" : "border-bad-line bg-bad-soft text-bad-ink"
            }`}
            aria-hidden="true"
          >
            <Icon className="size-7" />
          </span>
          <h1
            ref={heading}
            tabIndex={-1}
            className="mt-5 text-3xl font-extrabold tracking-tight text-ink focus:outline-none sm:text-4xl"
          >
            {noAnswer ? `${call.task.callee_name} didn't answer` : "The call didn't finish"}
          </h1>
          {call.detail && <p className="mt-3 text-lg text-ink-2">{call.detail}</p>}

          <div className="mt-7 flex flex-wrap gap-3">
            <button className={btn.primary} onClick={retry} disabled={retrying}>
              <RotateCcw className="size-5" aria-hidden="true" />
              {retrying ? "Calling again…" : "Retry call"}
            </button>
            <button className={btn.secondary} onClick={edit}>
              <PencilLine className="size-5" aria-hidden="true" />
              Edit details
            </button>
            <button className={btn.ghost} onClick={goHome}>
              New call
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 font-bold text-bad-ink">
              {error}
            </p>
          )}
        </section>

        {call.transcript.length > 0 && (
          <section className={card} aria-labelledby="partial-title">
            <h2 id="partial-title" className="border-b border-line px-6 py-5 text-xl font-extrabold text-ink sm:px-9">
              What was said before it ended
            </h2>
            <Transcript turns={call.transcript} calleeName={call.task.callee_name} startedAt={call.answered_at} />
          </section>
        )}
      </main>
    </div>
  );
}
