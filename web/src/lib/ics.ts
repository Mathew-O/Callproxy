import { parseDate, parseTime } from "./format";

export interface CalendarEvent {
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, 24-hour
  durationMinutes?: number;
  location?: string;
  description?: string;
  uid: string;
}

export function canAddToCalendar(details: Record<string, string>): boolean {
  return parseDate(details.date) !== null && parseTime(details.time) !== null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** Fold lines longer than 75 octets, as RFC 5545 asks. */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

/** Builds an .ics file. Times are "floating" so they land at the local time the office said. */
export function buildIcs(event: CalendarEvent, now: Date = new Date()): string {
  const d = parseDate(event.date);
  const t = parseTime(event.time);
  if (!d || !t) throw new Error("A date (YYYY-MM-DD) and time (HH:MM) are required");
  const start = new Date(d.y, d.m - 1, d.d, t.h, t.min);
  const end = new Date(start.getTime() + (event.durationMinutes ?? 60) * 60_000);
  const local = (x: Date) =>
    `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CallProxy//OwlHacks 2026//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}@callproxy`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${local(start)}`,
    `DTEND:${local(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    event.location ? `LOCATION:${escapeText(event.location)}` : null,
    event.description ? `DESCRIPTION:${escapeText(event.description)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadIcs(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
