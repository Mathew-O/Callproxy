import { Clapperboard, FlaskConical, Loader2, PhoneCall } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useConfig } from "../hooks/useVoices";
import { startDemo } from "../lib/demo";

/**
 * One button for the stage: starts the whole demo (practice, or a real call to the
 * judge's phone) with Jordan's lines typed automatically. No form to fill in.
 */
export function DemoLauncher() {
  const config = useConfig();
  const [open, setOpen] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [starting, setStarting] = useState<"practice" | "live" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const liveReady = !!config?.live_calls && !!config.demo_number;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const go = async (live: boolean) => {
    setStarting(live ? "live" : "practice");
    setError(null);
    try {
      await startDemo(live, autoplay);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the demo.");
      setStarting(null);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-accent px-4 text-base font-bold text-on-accent shadow-sm hover:bg-accent-hover"
      >
        <Clapperboard className="size-5" aria-hidden="true" />
        Demo
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-fade-in rounded-2xl border border-line bg-surface p-3 shadow-card"
        >
          <p className="px-1 pb-2 text-sm font-bold text-ink-2">Run the stage demo</p>
          <DemoOption
            icon={starting === "practice" ? <Loader2 className="size-5 motion-safe:animate-spin" /> : <FlaskConical className="size-5" />}
            title="Practice demo"
            body="Rings a practice receptionist. No phone needed."
            onClick={() => void go(false)}
            disabled={starting !== null}
          />
          <DemoOption
            icon={starting === "live" ? <Loader2 className="size-5 motion-safe:animate-spin" /> : <PhoneCall className="size-5" />}
            title="Live demo"
            body={
              liveReady
                ? `Calls the judge (${config?.demo_number}). Hand them the cue card first.`
                : config?.static
                  ? "Needs the CallProxy backend, so it isn't available on the web link."
                  : "Needs Twilio + ElevenLabs set up and DEMO_NUMBER (or ALLOWED_NUMBERS) in .env."
            }
            onClick={() => void go(true)}
            disabled={!liveReady || starting !== null}
          />
          <label className="mt-2 flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-sm font-bold text-ink hover:bg-surface-2">
            <input
              type="checkbox"
              checked={autoplay}
              onChange={(e) => setAutoplay(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Type Jordan's lines automatically
          </label>
          <p className="px-2 pt-1 text-xs text-ink-2">
            Tip: bookmark <code className="font-mono">#/demo</code> (or <code className="font-mono">#/demo/live</code>) to start in
            one click.
          </p>
          {error && (
            <p role="alert" className="px-2 pt-2 text-sm font-bold text-bad-ink">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DemoOption(props: { icon: ReactNode; title: string; body: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="flex w-full cursor-pointer items-start gap-3 rounded-xl p-2.5 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink" aria-hidden="true">
        {props.icon}
      </span>
      <span>
        <span className="block font-bold text-ink">{props.title}</span>
        <span className="block text-sm text-ink-2">{props.body}</span>
      </span>
    </button>
  );
}
