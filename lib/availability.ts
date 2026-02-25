import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  addMinutes,
  getDay,
  getHours,
  getMinutes,
  startOfDay,
} from "date-fns";

type Interval = [number, number]; // [startMs, endMs]

/** Merge overlapping/adjacent busy intervals into a sorted, non-overlapping list */
function mergeBusy(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

interface AvailabilityOptions {
  dateRangeStartMs: number;
  dateRangeEndMs: number;
  durationMinutes: number;
  workingHoursStart: string; // "HH:mm"
  workingHoursEnd: string;   // "HH:mm"
  timezone: string;
  excludeWeekends: boolean;
  participantBusySlots: Interval[][]; // One array per joined participant
}

/**
 * Compute all free candidate slots where every participant is available.
 * Returns sorted [startMs, endMs] pairs in UTC.
 */
export function computeFreeSlots(options: AvailabilityOptions): Interval[] {
  const {
    dateRangeStartMs,
    dateRangeEndMs,
    durationMinutes,
    workingHoursStart,
    workingHoursEnd,
    timezone,
    excludeWeekends,
    participantBusySlots,
  } = options;

  // Union of all participants' busy times
  const allBusy = mergeBusy(participantBusySlots.flat());

  const durationMs = durationMinutes * 60 * 1000;
  const freeSlots: Interval[] = [];

  // Parse working hours as minutes-from-midnight
  const [whStartH, whStartM] = workingHoursStart.split(":").map(Number);
  const [whEndH, whEndM] = workingHoursEnd.split(":").map(Number);
  const whStartMinutes = whStartH * 60 + whStartM;
  const whEndMinutes = whEndH * 60 + whEndM;

  // Iterate day by day within the date range
  let dayStart = startOfDay(toZonedTime(dateRangeStartMs, timezone));

  while (true) {
    const dayStartMs = fromZonedTime(dayStart, timezone).getTime();
    if (dayStartMs >= dateRangeEndMs) break;

    const dayOfWeek = getDay(dayStart); // 0=Sun, 6=Sat
    if (excludeWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
      dayStart = addMinutes(dayStart, 24 * 60);
      continue;
    }

    // Working window for this day (in UTC ms)
    const windowStartMs = fromZonedTime(
      addMinutes(startOfDay(dayStart), whStartMinutes),
      timezone
    ).getTime();
    const windowEndMs = fromZonedTime(
      addMinutes(startOfDay(dayStart), whEndMinutes),
      timezone
    ).getTime();

    // Clamp to overall date range
    const effectiveStart = Math.max(windowStartMs, dateRangeStartMs);
    const effectiveEnd = Math.min(windowEndMs, dateRangeEndMs);

    if (effectiveStart >= effectiveEnd) {
      dayStart = addMinutes(dayStart, 24 * 60);
      continue;
    }

    // Find free slots within this working window
    let cursor = effectiveStart;
    for (const [busyStart, busyEnd] of allBusy) {
      if (busyStart >= effectiveEnd) break;
      if (busyEnd <= cursor) continue;

      // Gap before this busy block
      if (busyStart > cursor && busyStart - cursor >= durationMs) {
        freeSlots.push([cursor, Math.min(busyStart, effectiveEnd)]);
      }
      cursor = Math.max(cursor, busyEnd);
    }

    // Remaining gap after last busy block
    if (effectiveEnd - cursor >= durationMs) {
      freeSlots.push([cursor, effectiveEnd]);
    }

    dayStart = addMinutes(dayStart, 24 * 60);
  }

  return freeSlots;
}

/** Chop free slots into exact-duration blocks starting on 30-min boundaries */
export function chopIntoSlots(freeSlots: Interval[], durationMinutes: number): Interval[] {
  const durationMs = durationMinutes * 60 * 1000;
  const slots: Interval[] = [];

  for (const [freeStart, freeEnd] of freeSlots) {
    // Round up to next 30-min boundary
    const thirtyMin = 30 * 60 * 1000;
    const snapped = Math.ceil(freeStart / thirtyMin) * thirtyMin;
    let start = snapped;

    while (start + durationMs <= freeEnd) {
      slots.push([start, start + durationMs]);
      start += thirtyMin; // Step by 30 min
    }
  }

  return slots;
}
