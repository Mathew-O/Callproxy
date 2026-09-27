import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { BrandMark } from "../components/Brand";
import { STATE_LABELS } from "../components/StatusPill";
import { useCallAudio } from "../hooks/useCallAudio";
import { useCallFeed } from "../hooks/useCallFeed";
import { useConfig } from "../hooks/useVoices";
import { goHome } from "../lib/nav";
import { btn } from "../lib/ui";
import { EndedEarly } from "./EndedEarly";
import { LiveCall } from "./LiveCall";
import { Summary } from "./Summary";

export function CallScreen({ callId }: { callId: string }) {
  const config = useConfig();
  const audio = useCallAudio(config?.tts ?? false);
  const { call, clockOffset, error, connection } = useCallFeed(callId, audio.onEvent);

  const needsDecision = call?.pending_question && !call.pending_question.timed_out;
  // The tab title doubles as an alert when the call is in a background tab.
  const title = !call
    ? "CallProxy"
    : needsDecision
      ? "⚠ Decision needed — CallProxy"
      : `${STATE_LABELS[call.state]} — CallProxy`;
  useEffect(() => {
    document.title = title;
  }, [title]);

  if (!call) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        {error ? (
          <div className="max-w-md text-center">
            <BrandMark className="mx-auto size-12" />
            <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-ink">We couldn't find that call</h1>
            <p className="mt-3 text-lg text-ink-2">
              {error} Calls are kept in memory, so a server restart clears them.
            </p>
            <button className={`${btn.primary} mt-7`} onClick={goHome}>
              Start a new call
            </button>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-3 text-lg font-bold text-ink-2">
            <Loader2 className="size-6 motion-safe:animate-spin" aria-hidden="true" />
            Connecting to your call…
          </p>
        )}
      </div>
    );
  }

  if (call.state === "completed") return <Summary call={call} />;
  if (call.state === "no_answer" || call.state === "failed") return <EndedEarly call={call} />;
  return <LiveCall call={call} clockOffset={clockOffset} connection={connection} config={config} audio={audio} />;
}
