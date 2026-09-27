import { useEffect, useState } from "react";
import { formatDuration } from "../lib/format";

interface Props {
  answeredAt: number | null;
  endedAt: number | null;
  clockOffset: number;
  limitSeconds?: number;
}

export function CallTimer({ answeredAt, endedAt, clockOffset, limitSeconds = 300 }: Props) {
  const [now, setNow] = useState(() => Date.now() / 1000 + clockOffset);

  useEffect(() => {
    if (!answeredAt || endedAt) return;
    const id = window.setInterval(() => setNow(Date.now() / 1000 + clockOffset), 500);
    return () => window.clearInterval(id);
  }, [answeredAt, endedAt, clockOffset]);

  if (!answeredAt) return null;
  const elapsed = (endedAt ?? now) - answeredAt;
  const nearLimit = !endedAt && limitSeconds - elapsed <= 60;
  return (
    <span
      role="timer"
      aria-label={`Call length ${formatDuration(elapsed)}`}
      className={`font-mono text-lg font-bold tabular-nums ${nearLimit ? "text-warn-ink" : "text-ink-2"}`}
    >
      {formatDuration(elapsed)}
      {nearLimit && <span className="ml-1 font-sans text-sm">(1 min left)</span>}
    </span>
  );
}
