import { mergeBusy, type Interval } from "./availability";
import {
  localDateDifferenceInDays,
  localDateRangeToUtcBounds,
  parseHourMinute,
  parseLocalDate,
  zonedWallClockToUtcMs,
} from "./time";

export interface ManualScheduleBlock {
  date: string;
  startTime: string;
  endTime: string;
}

export class ManualScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualScheduleValidationError";
  }
}

/**
 * Turns reviewed wall-clock blocks into the same UTC intervals calendar
 * providers return. The image and OCR text never reach this function or the
 * server; only the user's confirmed date/start/end values do.
 */
export function manualScheduleIntervals(input: {
  blocks: unknown;
  eventStartDate: string;
  eventEndDate: string;
  timezone: string;
}): Interval[] {
  if (!Array.isArray(input.blocks)) {
    throw new ManualScheduleValidationError("Busy times must be a list.");
  }
  if (input.blocks.length > 200) {
    throw new ManualScheduleValidationError("Too many busy times were submitted.");
  }

  const { startMs: windowStart, endMs: windowEnd } = localDateRangeToUtcBounds(
    input.eventStartDate,
    input.eventEndDate,
    input.timezone
  );

  const intervals = input.blocks.map((value, index): Interval => {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ManualScheduleValidationError(`Busy time ${index + 1} is invalid.`);
      }
      const block = value as Record<string, unknown>;
      parseLocalDate(block.date);
      if (
        localDateDifferenceInDays(input.eventStartDate, block.date as string) < 0 ||
        localDateDifferenceInDays(block.date as string, input.eventEndDate) < 0
      ) {
        throw new ManualScheduleValidationError(
          `Busy time ${index + 1} is outside this invitation's date window.`
        );
      }

      const startMinutes = parseHourMinute(block.startTime);
      const endMinutes = parseHourMinute(block.endTime, { allowEndOfDay: true });
      if (endMinutes <= startMinutes) {
        throw new ManualScheduleValidationError(
          `Busy time ${index + 1} must end after it starts.`
        );
      }

      const start = zonedWallClockToUtcMs(
        block.date as string,
        startMinutes,
        input.timezone
      );
      const end = zonedWallClockToUtcMs(
        block.date as string,
        endMinutes,
        input.timezone
      );
      if (start < windowStart || end > windowEnd || end <= start) {
        throw new ManualScheduleValidationError(`Busy time ${index + 1} is invalid.`);
      }
      return [start, end];
    } catch (error) {
      if (error instanceof ManualScheduleValidationError) throw error;
      throw new ManualScheduleValidationError(`Busy time ${index + 1} is invalid.`);
    }
  });

  return mergeBusy(intervals);
}

export function serializeManualIntervals(intervals: Interval[]): string {
  return JSON.stringify(mergeBusy(intervals));
}

/** Returns null for malformed legacy data so it can never mean "free". */
export function parseManualIntervals(raw: string): Interval[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 200) return null;
    const intervals: Interval[] = parsed.map((value) => {
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !Number.isFinite(value[0]) ||
        !Number.isFinite(value[1]) ||
        !Number.isSafeInteger(value[0]) ||
        !Number.isSafeInteger(value[1]) ||
        value[1] <= value[0]
      ) {
        throw new Error("Invalid interval");
      }
      return [value[0], value[1]];
    });
    return mergeBusy(intervals);
  } catch {
    return null;
  }
}
