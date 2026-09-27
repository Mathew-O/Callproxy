import { Sparkles } from "lucide-react";

function initials(name: string): string {
  const words = name
    .replace(/['’]s\b/g, "") // "Dr. Rivera's office" -> RO, not RS
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(the|of|and|dr|mr|mrs|ms)$/i.test(w));
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

interface Props {
  name: string;
  kind: "agent" | "callee";
  speaking?: boolean;
  size?: "sm" | "lg";
}

/** Initials (or the AI mark) with a pulsing ring while that person is talking. */
export function Avatar({ name, kind, speaking = false, size = "sm" }: Props) {
  const dims = size === "lg" ? "size-16 text-2xl" : "size-11 text-base";
  const tone = kind === "agent" ? "bg-accent text-on-accent" : "bg-surface-2 text-ink border-2 border-line";
  return (
    <span className={`relative inline-grid shrink-0 place-items-center rounded-full font-extrabold ${dims} ${tone}`} aria-hidden="true">
      {speaking && (
        <span
          className={`absolute inset-0 hidden rounded-full motion-safe:block motion-safe:animate-ring ${kind === "agent" ? "bg-accent" : "bg-ok"}`}
        />
      )}
      {speaking && (
        <span className={`absolute -inset-1 rounded-full border-2 ${kind === "agent" ? "border-accent" : "border-ok"}`} />
      )}
      <span className="relative">{kind === "agent" ? <Sparkles className={size === "lg" ? "size-7" : "size-5"} /> : initials(name)}</span>
    </span>
  );
}

/** Three bouncing bars, the universal "someone is talking" signal. */
export function SpeakingBars({ tone = "accent" }: { tone?: "accent" | "ok" }) {
  return (
    <span className="inline-flex h-4 items-center gap-[3px]" aria-hidden="true">
      {[0, 180, 90].map((delay) => (
        <span
          key={delay}
          className={`h-full w-[3px] origin-center rounded-full motion-safe:animate-speak ${tone === "accent" ? "bg-accent-ink" : "bg-ok-ink"}`}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
