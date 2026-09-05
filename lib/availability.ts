import {
  enumerateLocalDates,
  localDateWeekday,
  parseWorkingHours,
  zonedWallClockToUtcMs,
  type LocalDate,
} from "./time";
import {
  HOUR_SLOTS_PER_DAY,
  isBlockedWeeklyState,
  mondayFirstDayIndex,
  weeklySlotIndex,
  type WeeklySlotState,
} from "./weekly-availability";

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
  /** Monday-first, 24 hourly cells per day. Overrides legacy day bounds. */
  weeklyAvailability?: WeeklySlotState[] | null;
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
    weeklyAvailability,
  } = request;

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error(`durationMinutes must be a positive integer`);
  }
  if (!Number.isInteger(granularityMinutes) || granularityMinutes <= 0) {
    throw new Error(`granularityMinutes must be a positive integer`);
  }

  const legacyWindow = parseWorkingHours(
    request.workingHoursStart,
    request.workingHoursEnd
  );
  const startMinutes = weeklyAvailability ? 0 : legacyWindow.startMinutes;
  const endMinutes = weeklyAvailability ? 24 * 60 : legacyWindow.endMinutes;

  // A meeting longer than the working day can never fit; say so by returning
  // nothing rather than by looping over every day to discover it.
  if (durationMinutes > endMinutes - startMinutes) return [];

  const busy = mergeBusy(busyByParticipant.flat());
  const durationMs = durationMinutes * 60 * 1000;
  const slots: Array<{
    interval: Interval;
    preference: number;
  }> = [];

  for (const date of enumerateLocalDates(startDate, endDate)) {
    const weekday = localDateWeekday(date);
    if (!weeklyAvailability && excludeWeekends) {
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

      const preference = weeklyAvailability
        ? weeklyPreference(
            weeklyAvailability,
            mondayFirstDayIndex(weekday),
            offset,
            durationMinutes
          )
        : 0;
      if (preference === null) continue;

      slots.push({
        interval: [slotStartMs, slotEndMs],
        preference,
      });
    }
  }

  return slots
    .sort(
      (a, b) =>
        b.preference - a.preference ||
        a.interval[0] - b.interval[0] ||
        a.interval[1] - b.interval[1]
    )
    .slice(0, maxSlots)
    .map(({ interval }) => interval);
}

function weeklyPreference(
  availability: WeeklySlotState[],
  dayIndex: number,
  startMinutes: number,
  durationMinutes: number
): number | null {
  const firstCell = Math.floor(startMinutes / 60);
  const lastCell = Math.ceil((startMinutes + durationMinutes) / 60);
  if (firstCell < 0 || lastCell > HOUR_SLOTS_PER_DAY) return null;

  let preferredCells = 0;
  for (let cell = firstCell; cell < lastCell; cell += 1) {
    const state = availability[weeklySlotIndex(dayIndex, cell)];
    if (!state || isBlockedWeeklyState(state)) return null;
    if (state === "preferred") preferredCells += 1;
  }
  return preferredCells;
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
