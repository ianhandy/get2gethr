/**
 * Local-date and timezone primitives.
 *
 * The scheduling window is expressed the way a person says it: "Monday through
 * Friday", as calendar dates in the event's IANA timezone. Both endpoints are
 * INCLUSIVE — the last date contributes a full day of usable hours.
 *
 * Everything here is built on `Intl.DateTimeFormat` offset lookups rather than
 * on arithmetic over `Date`, so daylight-saving transitions never silently
 * shift a day. No function in this module reads the host machine's timezone.
 */

/** A calendar date with no time component, formatted `YYYY-MM-DD`. */
export type LocalDate = string;

export const MINUTES_PER_DAY = 24 * 60;

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MINUTE_RE = /^(\d{2}):(\d{2})$/;

export class TimeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeValidationError";
  }
}

/** True when `tz` is an IANA zone this runtime actually supports. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimeZone(tz: unknown): string {
  if (!isValidTimeZone(tz)) {
    throw new TimeValidationError(`Unknown timezone: ${String(tz)}`);
  }
  return tz;
}

/** Parses `YYYY-MM-DD`, rejecting shapes that look valid but are not real dates. */
export function parseLocalDate(value: unknown): {
  year: number;
  month: number;
  day: number;
} {
  if (typeof value !== "string") {
    throw new TimeValidationError(`Expected a YYYY-MM-DD date, got ${typeof value}`);
  }
  const match = LOCAL_DATE_RE.exec(value);
  if (!match) {
    throw new TimeValidationError(`Expected a YYYY-MM-DD date, got "${value}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-tripping through Date.UTC catches 2025-02-30 and friends.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new TimeValidationError(`Not a real calendar date: "${value}"`);
  }
  return { year, month, day };
}

export function isValidLocalDate(value: unknown): value is LocalDate {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function formatLocalDate(year: number, month: number, day: number): LocalDate {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Minutes from midnight for an `HH:mm` string.
 *
 * `24:00` is accepted only when `allowEndOfDay` is set, so a working window can
 * legitimately run to the end of the day without wrapping into the next one.
 */
export function parseHourMinute(
  value: unknown,
  { allowEndOfDay = false }: { allowEndOfDay?: boolean } = {}
): number {
  if (typeof value !== "string") {
    throw new TimeValidationError(`Expected an HH:mm time, got ${typeof value}`);
  }
  const match = HOUR_MINUTE_RE.exec(value);
  if (!match) {
    throw new TimeValidationError(`Expected an HH:mm time, got "${value}"`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) {
    throw new TimeValidationError(`Minutes out of range in "${value}"`);
  }
  const total = hours * 60 + minutes;
  const max = allowEndOfDay ? MINUTES_PER_DAY : MINUTES_PER_DAY - 1;
  if (hours > 24 || total > max) {
    throw new TimeValidationError(`Time out of range: "${value}"`);
  }
  return total;
}

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = offsetFormatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    offsetFormatterCache.set(tz, formatter);
  }
  return formatter;
}

/** The zone's UTC offset, in ms, at the instant `utcMs`. */
export function timeZoneOffsetMs(utcMs: number, tz: string): number {
  const parts = offsetFormatter(tz).formatToParts(new Date(utcMs));
  const field = (type: string) => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new TimeValidationError(`Timezone ${tz} produced no ${type}`);
    return Number(part.value);
  };
  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second")
  );
  return asIfUtc - utcMs;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The UTC instant for a wall-clock time in `tz`.
 *
 * A naive two-pass offset lookup oscillates around a daylight-saving boundary,
 * so instead we test both the pre- and post-transition offsets and keep only
 * candidates that actually round-trip to the requested wall clock:
 *
 * - two candidates (the hour repeats after a fall-back) → the first occurrence
 * - one candidate (the ordinary case) → that one
 * - no candidates (the hour is skipped by a spring-forward) → shifted forward
 *   past the gap, so 02:30 on a US spring-forward day means 03:30
 *
 * Every branch is deterministic and pinned by tests.
 */
export function zonedWallClockToUtcMs(
  date: LocalDate,
  minutesFromMidnight: number,
  tz: string
): number {
  assertValidTimeZone(tz);
  const { year, month, day } = parseLocalDate(date);
  const naive = Date.UTC(year, month - 1, day, 0, minutesFromMidnight);

  const offsetBefore = timeZoneOffsetMs(naive - DAY_MS, tz);
  const offsetAfter = timeZoneOffsetMs(naive + DAY_MS, tz);

  const candidates = [naive - offsetBefore, naive - offsetAfter]
    .filter((utcMs, index, all) => all.indexOf(utcMs) === index)
    .filter((utcMs) => timeZoneOffsetMs(utcMs, tz) === naive - utcMs)
    .sort((a, b) => a - b);

  if (candidates.length > 0) return candidates[0];

  // The requested wall clock falls inside a spring-forward gap. Using the
  // pre-transition offset lands just past the gap, which is what a person
  // means by "9am" on a day where 9am was skipped.
  return naive - offsetBefore;
}

/** The calendar date `offsetDays` away from `date`, using pure calendar math. */
export function addLocalDays(date: LocalDate, offsetDays: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return formatLocalDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate()
  );
}

/** Day of week for a calendar date: 0 = Sunday … 6 = Saturday. */
export function localDateWeekday(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Whole days from `from` to `to`; negative when `to` precedes `from`. */
export function localDateDifferenceInDays(from: LocalDate, to: LocalDate): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) /
      msPerDay
  );
}

/**
 * Every calendar date from `start` through `end`, both inclusive.
 *
 * Iterating dates rather than adding 24h at a time is what keeps a DST day from
 * being skipped or visited twice.
 */
export function enumerateLocalDates(start: LocalDate, end: LocalDate): LocalDate[] {
  const span = localDateDifferenceInDays(start, end);
  if (span < 0) {
    throw new TimeValidationError(`Range end "${end}" precedes start "${start}"`);
  }
  const dates: LocalDate[] = [];
  for (let i = 0; i <= span; i++) dates.push(addLocalDays(start, i));
  return dates;
}

/**
 * UTC bounds for an inclusive local date range.
 *
 * `endMs` is midnight at the start of the day *after* `endDate`, so the last
 * date keeps all of its hours. A same-day range is valid and spans one day.
 */
export function localDateRangeToUtcBounds(
  startDate: LocalDate,
  endDate: LocalDate,
  tz: string
): { startMs: number; endMs: number } {
  assertValidTimeZone(tz);
  if (localDateDifferenceInDays(startDate, endDate) < 0) {
    throw new TimeValidationError(
      `Latest date "${endDate}" is before earliest date "${startDate}"`
    );
  }
  return {
    startMs: zonedWallClockToUtcMs(startDate, 0, tz),
    endMs: zonedWallClockToUtcMs(addLocalDays(endDate, 1), 0, tz),
  };
}

/** The calendar date that the instant `utcMs` falls on in `tz`. */
export function utcMsToLocalDate(utcMs: number, tz: string): LocalDate {
  assertValidTimeZone(tz);
  const parts = offsetFormatter(tz).formatToParts(new Date(utcMs));
  const field = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return formatLocalDate(field("year"), field("month"), field("day"));
}

export interface WorkingHours {
  startMinutes: number;
  endMinutes: number;
}

/**
 * Validates a working-hours pair. The window must be non-empty and must not
 * wrap past midnight — an overnight window is a different feature, not a
 * silently reinterpreted typo.
 */
export function parseWorkingHours(
  workingHoursStart: unknown,
  workingHoursEnd: unknown
): WorkingHours {
  const startMinutes = parseHourMinute(workingHoursStart);
  const endMinutes = parseHourMinute(workingHoursEnd, { allowEndOfDay: true });
  if (endMinutes <= startMinutes) {
    throw new TimeValidationError(
      `Working hours end (${workingHoursEnd}) must be after start (${workingHoursStart})`
    );
  }
  return { startMinutes, endMinutes };
}
