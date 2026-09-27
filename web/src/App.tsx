import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { startDemo } from "./lib/demo";
import { currentCallId, goHome } from "./lib/nav";
import { CallScreen } from "./screens/CallScreen";
import { NewCall } from "./screens/NewCall";

function demoRoute(): "practice" | "live" | null {
  if (location.hash === "#/demo/live") return "live";
  if (location.hash === "#/demo") return "practice";
  return null;
}

export default function App() {
  const [callId, setCallId] = useState(currentCallId);
  const [demo, setDemo] = useState(demoRoute);

  useEffect(() => {
    const onHash = () => {
      setCallId(currentCallId());
      setDemo(demoRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (demo) return <DemoStart live={demo === "live"} />;
  return callId ? <CallScreen key={callId} callId={callId} /> : <NewCall />;
}

/** Bookmarkable one-click demo: #/demo (practice) or #/demo/live (calls the judge). */
function DemoStart({ live }: { live: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startDemo(live).catch((e: Error) => setError(e.message));
  }, [live]);
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      {error ? (
        <div>
          <p role="alert" className="text-lg font-bold text-bad-ink">
            {error}
          </p>
          <button className="mt-4 font-bold text-accent-ink underline" onClick={goHome}>
            Back to CallProxy
          </button>
        </div>
      ) : (
        <p role="status" className="flex items-center gap-3 text-lg font-bold text-ink-2">
          <Loader2 className="size-6 motion-safe:animate-spin" aria-hidden="true" />
          Starting the {live ? "live" : "practice"} demo…
        </p>
      )}
    </div>
  );
}
