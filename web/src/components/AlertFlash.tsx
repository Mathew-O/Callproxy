import { useEffect, useState } from "react";

/**
 * A visual alert for a new decision: an amber screen flash plus a phone vibration.
 * Never sound alone. Two slow pulses (under 3 per second); a steady frame if the
 * reader prefers reduced motion.
 */
export function AlertFlash({ trigger }: { trigger: string | null }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!trigger) return;
    setActive(trigger);
    navigator.vibrate?.([250, 120, 250, 120, 400]);
    const id = window.setTimeout(() => setActive(null), 1700);
    return () => window.clearTimeout(id);
  }, [trigger]);

  if (!active) return null;
  return (
    <div
      key={active}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 border-[14px] border-warn bg-warn/25 motion-safe:animate-alert-flash"
    />
  );
}
