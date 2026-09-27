import { useEffect, useState } from "react";

interface Props {
  /** The other side is talking right now. */
  speaking: boolean;
  name: string;
  /** "float" hovers in the wide-screen gutter; "inline" sits under the captions on smaller screens. */
  variant: "float" | "inline";
}

// Each bar gets its own rhythm so the four never move in lockstep.
const BARS = [
  { duration: "0.9s", delay: "-0.2s" },
  { duration: "0.7s", delay: "-0.5s" },
  { duration: "1.05s", delay: "-0.1s" },
  { duration: "0.8s", delay: "-0.35s" },
];

/**
 * Four vertical audio bars that move while the other person talks. For someone who can't
 * hear the call, it's the at-a-glance signal that words are coming; the captions follow.
 */
export function VoiceActivity({ speaking, name, variant }: Props) {
  const [visible, setVisible] = useState(speaking);

  // Linger a moment after they stop, so the bars don't flicker between breaths.
  useEffect(() => {
    if (speaking) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(false), 700);
    return () => window.clearTimeout(t);
  }, [speaking]);

  const bars = (
    <div className={`flex items-center ${variant === "float" ? "h-16 gap-2" : "h-10 gap-1.5"}`}>
      {BARS.map((bar, i) => (
        <span
          key={i}
          className={`voice-bar rounded-full bg-ink ${variant === "float" ? "w-3.5" : "w-2.5"} ${speaking ? "is-speaking" : ""}`}
          style={{ animationDuration: bar.duration, animationDelay: bar.delay }}
        />
      ))}
    </div>
  );
  const label = (
    <span className="max-w-[12rem] text-center text-sm leading-tight font-bold text-ink-2">
      <span className="line-clamp-1 text-ink">{name}</span>
      is speaking
    </span>
  );

  if (variant === "float") {
    return (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute right-10 bottom-8 z-10 hidden flex-col items-center gap-3 transition-opacity duration-300 xl:flex ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        {bars}
        {label}
      </div>
    );
  }
  if (!visible) return null;
  return (
    <div aria-hidden="true" className="flex animate-fade-in items-center justify-center gap-4 px-4 pt-1 pb-5 xl:hidden">
      {bars}
      {label}
    </div>
  );
}
