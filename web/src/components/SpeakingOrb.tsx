import { useEffect, useRef, useState } from "react";

interface Props {
  /** The other side is talking right now. */
  speaking: boolean;
  name: string;
  /** Their words so far; each new word gives the orb a little bump, like it's hearing them. */
  partial: string;
  /** "float" hovers in the wide-screen gutter; "inline" sits under the captions on smaller screens. */
  variant: "float" | "inline";
}

/**
 * An orb that comes alive while the other person talks, in the spirit of ChatGPT's voice
 * orb and Siri. For someone who can't hear the call it's the at-a-glance signal that words
 * are coming; the captions follow.
 */
export function SpeakingOrb({ speaking, name, partial, variant }: Props) {
  const [visible, setVisible] = useState(speaking);
  const [bump, setBump] = useState(1);
  const words = partial.split(/\s+/).filter(Boolean).length;
  const lastWords = useRef(words);

  // Linger a moment after they stop, so the orb doesn't flicker between breaths.
  useEffect(() => {
    if (speaking) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(false), 700);
    return () => window.clearTimeout(t);
  }, [speaking]);

  useEffect(() => {
    if (words === lastWords.current) return;
    lastWords.current = words;
    setBump(1.06 + Math.random() * 0.1);
    const t = window.setTimeout(() => setBump(1), 140);
    return () => window.clearTimeout(t);
  }, [words]);

  const orb = (
    <div className="relative shrink-0">
      {speaking && <span className="orb-ring" />}
      <div
        className={`orb ${variant === "float" ? "size-32" : "size-16"}`}
        style={{ transform: `scale(${speaking ? bump : 0.94})` }}
      >
        <span className="orb-blob orb-blob-a" />
        <span className="orb-blob orb-blob-b" />
        <span className="orb-blob orb-blob-c" />
        <span className="orb-shine" />
      </div>
    </div>
  );
  const label = (
    <span className="max-w-[12rem] rounded-2xl border border-ok-line bg-surface/95 px-3 py-1 text-center text-sm leading-tight font-bold text-ok-ink shadow-sm backdrop-blur">
      <span className="line-clamp-1 text-ink">{name}</span>
      is speaking
    </span>
  );

  if (variant === "float") {
    return (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute right-10 bottom-8 z-10 hidden flex-col items-center gap-2 transition-all duration-300 xl:flex ${
          visible ? "scale-100 opacity-100" : "scale-75 opacity-0"
        }`}
      >
        {orb}
        {label}
      </div>
    );
  }
  if (!visible) return null;
  return (
    <div aria-hidden="true" className="flex animate-fade-in items-center justify-center gap-4 px-4 pt-2 pb-6 xl:hidden">
      {orb}
      {label}
    </div>
  );
}
