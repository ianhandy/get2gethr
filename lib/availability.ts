import {
  enumerateLocalDates,
  localDateWeekday,
  parseWorkingHours,
  zonedWallClockToUtcMs,
  type LocalDate,
} from "./time";

/** A half-open interval of real time, `[startMs, endMs)`, in UTC milliseconds. */
export type Interval = [number, number];

export const DEFAULT_GRANULARITY_MINUTES = 30;

/**
 * Merge overlapping and touching busy intervals into a sorted, disjoint list.
 * Input is never mutated.
 */
export function mergeBusy(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter(([start, end]) => end > start)
    .map(([start, end]): Interval => [start, end])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) {
      last[1] = Math.max(last[1], interval[1]);
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

export interface CandidateSlotRequest {
  /** First calendar date of the window, in `timezone`. Inclusive. */
  startDate: LocalDate;
  /** Last calendar date of the window, in `timezone`. Inclusive. */
  endDate: LocalDate;
  timezone: string;
  durationMinutes: number;
  /** `HH:mm` in `timezone`. */
  workingHoursStart: string;
  /** `HH:mm` in `timezone`; `24:00` is allowed. */
  workingHoursEnd: string;
  excludeWeekends: boolean;
  /** One busy list per participant. Empty list means "free all window". */
  busyByParticipant: Interval[][];
  /** Slot starts land on multiples of this many minutes past the window start. */
  granularityMinutes?: number;
  /** Slots starting before this instant are dropped. Defaults to no floor. */
  notBeforeMs?: number;
  /** Safety valve so a wide window cannot generate unbounded work. */
  maxSlots?: number;
}

/**
 * Every slot inside the window where no participant is busy.
 *
 * Ranking is deterministic and total: earliest start first, then earliest end.
 * Two runs over the same inputs always produce the same ordered list, which is
 * what lets the scheduler resume, retry, and re-propose without drifting.
 *
 * Days are walked as calendar dates rather than by adding 24 hours, and each
 * day's working window is resolved as a wall clock in `timezone`, so a
 * daylight-saving day contributes exactly its real hours.
 */
export function computeCandidateSlots(request: CandidateSlotRequest): Interval[] {
  const {
    startDate,
    endDate,
    timezone,
    durationMinutes,
    excludeWeekends,
    busyByParticipant,
    granularityMinutes = DEFAULT_GRANULARITY_MINUTES,
    notBeforeMs,
    maxSlots = 5000,
  } = request;

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error(`durationMinutes must be a positive integer`);
  }
  if (!Number.isInteger(granularityMinutes) || granularityMinutes <= 0) {
    throw new Error(`granularityMinutes must be a positive integer`);
  }

  const { startMinutes, endMinutes } = parseWorkingHours(
    request.workingHoursStart,
    request.workingHoursEnd
  );

  // A meeting longer than the working day can never fit; say so by returning
  // nothing rather than by looping over every day to discover it.
  if (durationMinutes > endMinutes - startMinutes) return [];

  const busy = mergeBusy(busyByParticipant.flat());
  const durationMs = durationMinutes * 60 * 1000;
  const slots: Interval[] = [];

  for (const date of enumerateLocalDates(startDate, endDate)) {
    if (excludeWeekends) {
      const weekday = localDateWeekday(date);
      if (weekday === 0 || weekday === 6) continue;
    }

    const windowEndMs = zonedWallClockToUtcMs(date, endMinutes, timezone);

    for (
      let offset = startMinutes;
      offset + durationMinutes <= endMinutes;
      offset += granularityMinutes
    ) {
      const slotStartMs = zonedWallClockToUtcMs(date, offset, timezone);
      const slotEndMs = slotStartMs + durationMs;

      // A spring-forward gap can push a wall-clock start past the window end.
      if (slotEndMs > windowEndMs) continue;
      if (notBeforeMs !== undefined && slotStartMs < notBeforeMs) continue;
      if (overlapsBusy(slotStartMs, slotEndMs, busy)) continue;

      slots.push([slotStartMs, slotEndMs]);
      if (slots.length >= maxSlots) return sortSlots(slots);
    }
  }

  return sortSlots(slots);
}

function sortSlots(slots: Interval[]): Interval[] {
  return slots.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** True when `[startMs, endMs)` intersects any interval in a sorted busy list. */
export function overlapsBusy(
  startMs: number,
  endMs: number,
  sortedBusy: Interval[]
): boolean {
  for (const [busyStart, busyEnd] of sortedBusy) {
    if (busyStart >= endMs) return false; // sorted, so nothing later can overlap
    if (busyEnd > startMs) return true;
  }
  return false;
}

/**
 * Whether a specific slot is still free. Used for the recheck immediately
 * before a slot is proposed or written to a calendar, where availability may
 * have changed since the candidates were generated.
 */
export function isSlotStillFree(
  slot: Interval,
  busyByParticipant: Interval[][]
): boolean {
  return !overlapsBusy(slot[0], slot[1], mergeBusy(busyByParticipant.flat()));
}
