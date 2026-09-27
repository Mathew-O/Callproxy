const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseDate(value: string | undefined): { y: number; m: number; d: number } | null {
  const match = value?.trim().match(DATE_RE);
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const check = new Date(y, m - 1, d);
  return check.getMonth() === m - 1 && check.getDate() === d ? { y, m, d } : null;
}

export function parseTime(value: string | undefined): { h: number; min: number } | null {
  const match = value?.trim().match(TIME_RE);
  return match ? { h: Number(match[1]), min: Number(match[2]) } : null;
}

export function formatDate(value: string): string {
  const d = parseDate(value);
  if (!d) return value;
  return new Date(d.y, d.m - 1, d.d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(value: string): string {
  const t = parseTime(value);
  if (!t) return value;
  const suffix = t.h >= 12 ? "PM" : "AM";
  return `${t.h % 12 || 12}:${String(t.min).padStart(2, "0")} ${suffix}`;
}

const LABELS: Record<string, string> = {
  date: "Date",
  time: "Time",
  duration_minutes: "Length",
  location: "Where",
  confirmation_number: "Confirmation #",
  contact_name: "Spoke with",
  price: "Price",
  notes: "Notes",
};

export function detailLabel(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function detailValue(key: string, value: string): string {
  if (key === "date") return formatDate(value);
  if (key === "time") return formatTime(value);
  if (key === "duration_minutes" && /^\d+$/.test(value)) return `${value} minutes`;
  return value;
}

/** Order details so the ones people scan for come first. */
export function orderedDetails(details: Record<string, string>): [string, string][] {
  const order = Object.keys(LABELS);
  return Object.entries(details).sort(([a], [b]) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
