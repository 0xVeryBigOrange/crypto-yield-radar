export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    weekday: bag.weekday ?? "Mon",
  };
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function zhDate(day: string): string {
  const [year, month, date] = day.split("-");
  return `${year}年${Number(month)}月${Number(date)}日`;
}

/** Calendar day in Asia/Singapore, which is the omen's refresh boundary (00:00, no DST). */
export function sgDay(now = new Date()): string {
  const parts = zonedParts(now, "Asia/Singapore");
  return isoDate(parts.year, parts.month, parts.day);
}

export function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const cursor = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor.toISOString().slice(0, 10);
}

export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const cursor = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
  cursor.setUTCDate(cursor.getUTCDate() + count);
  return cursor.toISOString().slice(0, 10);
}

/** Monday of the Singapore calendar week that contains `day`. */
export function weekStart(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const cursor = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
  const weekday = cursor.getUTCDay();
  const delta = weekday === 0 ? 6 : weekday - 1;
  cursor.setUTCDate(cursor.getUTCDate() - delta);
  return cursor.toISOString().slice(0, 10);
}

function isWeekend(day: string): boolean {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * The US cash session this card belongs to.
 * Weekends and times at or after 16:00 America/New_York roll forward to the next weekday.
 * The card is therefore ready before 09:30 New York, and stays the same through that session.
 */
export function usSessionDate(now = new Date()): string {
  const parts = zonedParts(now, "America/New_York");
  let day = isoDate(parts.year, parts.month, parts.day);
  const afterClose = parts.hour > 16 || (parts.hour === 16 && parts.minute >= 0);
  if (isWeekend(day) || afterClose) day = addDays(day, 1);
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}
