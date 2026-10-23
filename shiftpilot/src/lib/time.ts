import { TZDate } from "@date-fns/tz";

export const DEFAULT_TZ = "Asia/Singapore";

export const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DOW_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar parts of an instant in the given timezone. dow: 0 = Monday. */
export function localParts(d: Date, tz = DEFAULT_TZ) {
  const z = new TZDate(d.getTime(), tz);
  const date = `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`;
  const minutes = z.getHours() * 60 + z.getMinutes();
  const dow = (z.getDay() + 6) % 7;
  return { date, minutes, dow, hour: z.getHours(), minute: z.getMinutes() };
}

export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function fromMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad(h)}:${pad(m)}`;
}

/** Instant for a local date (YYYY-MM-DD) and time (HH:MM or minutes). */
export function atLocal(date: string, time: string | number, tz = DEFAULT_TZ): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const mins = typeof time === "number" ? time : toMinutes(time);
  const z = new TZDate(y, mo - 1, d, Math.floor(mins / 60), mins % 60, 0, tz);
  return new Date(z.getTime());
}

export function addDays(date: string, n: number) {
  const [y, mo, d] = date.split("-").map(Number);
  const u = new Date(Date.UTC(y, mo - 1, d + n));
  return `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`;
}

/** 0 = Monday */
export function dowOf(date: string) {
  const [y, mo, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
}

export function weekStartOf(date: string) {
  return addDays(date, -dowOf(date));
}

export function weekDates(weekStart: string) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function isoWeek(date: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function daysBetween(a: string, b: string) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function fmtTime(d: Date, tz = DEFAULT_TZ) {
  const p = localParts(d, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "Sat 24 Oct" */
export function fmtDay(date: string) {
  const [, mo, d] = date.split("-").map(Number);
  return `${DOW_SHORT[dowOf(date)]} ${d} ${MONTHS[mo - 1]}`;
}

/** "24 Oct" */
export function fmtShortDate(date: string) {
  const [, mo, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[mo - 1]}`;
}

/** "7am", "4:30pm" */
export function fmtClock12(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${pad(m)}${suffix}` : `${h12}${suffix}`;
}

export function fmtRange12(startMin: number, endMin: number) {
  return `${fmtClock12(startMin)}–${fmtClock12(endMin)}`;
}

/** Shift time range from instants: "7am–1pm" */
export function fmtShiftRange(startsAt: Date, endsAt: Date, tz = DEFAULT_TZ) {
  return fmtRange12(localParts(startsAt, tz).minutes, localParts(endsAt, tz).minutes || 24 * 60);
}

export function hoursBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

/** Relative description used in agent prompts: "today", "tomorrow", "Sat 24 Oct" */
export function relativeDay(date: string, today: string) {
  const diff = daysBetween(today, date);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return fmtDay(date);
}

export const BLOCKS = {
  morning: { start: 7 * 60, end: 12 * 60, label: "Morning (7am–12pm)" },
  afternoon: { start: 12 * 60, end: 17 * 60, label: "Afternoon (12–5pm)" },
  evening: { start: 17 * 60, end: 23 * 60, label: "Evening (5–11pm)" },
} as const;
export type BlockKey = keyof typeof BLOCKS;
