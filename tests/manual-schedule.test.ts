import { describe, expect, it } from "vitest";
import {
  deviceCalendarIntervals,
  ManualScheduleValidationError,
  manualScheduleIntervals,
  parseManualIntervals,
  serializeManualIntervals,
} from "@/lib/manual-schedule";
import { zonedWallClockToUtcMs } from "@/lib/time";

const event = {
  eventStartDate: "2026-08-31",
  eventEndDate: "2026-09-04",
  timezone: "America/New_York",
};

function at(date: string, time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return zonedWallClockToUtcMs(date, hour * 60 + minute, event.timezone);
}

describe("manual schedule intervals", () => {
  it("converts reviewed local blocks to UTC and merges overlaps", () => {
    const intervals = manualScheduleIntervals({
      ...event,
      blocks: [
        { date: "2026-08-31", startTime: "09:00", endTime: "10:30" },
        { date: "2026-08-31", startTime: "10:00", endTime: "11:00" },
        { date: "2026-09-01", startTime: "14:00", endTime: "15:00" },
      ],
    });

    expect(intervals).toEqual([
      [at("2026-08-31", "09:00"), at("2026-08-31", "11:00")],
      [at("2026-09-01", "14:00"), at("2026-09-01", "15:00")],
    ]);
  });

  it("accepts an explicitly reviewed empty schedule", () => {
    expect(manualScheduleIntervals({ ...event, blocks: [] })).toEqual([]);
  });

  it("rejects dates outside the invitation window", () => {
    expect(() =>
      manualScheduleIntervals({
        ...event,
        blocks: [
          { date: "2026-09-05", startTime: "09:00", endTime: "10:00" },
        ],
      })
    ).toThrow(ManualScheduleValidationError);
  });

  it("rejects backwards, malformed, and oversized submissions", () => {
    expect(() =>
      manualScheduleIntervals({
        ...event,
        blocks: [
          { date: "2026-08-31", startTime: "10:00", endTime: "09:00" },
        ],
      })
    ).toThrow(/end after/i);
    expect(() => manualScheduleIntervals({ ...event, blocks: {} })).toThrow(
      /list/i
    );
    expect(() =>
      manualScheduleIntervals({
        ...event,
        blocks: [{ date: "not-a-date", startTime: "nine", endTime: "ten" }],
      })
    ).toThrow(ManualScheduleValidationError);
    expect(() =>
      manualScheduleIntervals({
        ...event,
        blocks: Array.from({ length: 201 }, () => ({
          date: "2026-08-31",
          startTime: "09:00",
          endTime: "10:00",
        })),
      })
    ).toThrow(/too many/i);
  });

  it("round-trips trusted storage and rejects malformed legacy data", () => {
    const intervals = [[at("2026-08-31", "09:00"), at("2026-08-31", "10:00")]] as [
      number,
      number,
    ][];
    expect(parseManualIntervals(serializeManualIntervals(intervals))).toEqual(intervals);
    expect(parseManualIntervals('{"not":"intervals"}')).toBeNull();
    expect(parseManualIntervals("[[10,5]]")).toBeNull();
  });
});

describe("device calendar intervals", () => {
  it("accepts, sorts, and merges UTC millisecond intervals", () => {
    expect(
      deviceCalendarIntervals({
        ...event,
        intervals: [
          [at("2026-08-31", "10:00"), at("2026-08-31", "11:00")],
          [at("2026-08-31", "09:00"), at("2026-08-31", "10:00")],
        ],
      })
    ).toEqual([[at("2026-08-31", "09:00"), at("2026-08-31", "11:00")]]);
  });

  it("rejects malformed and out-of-window intervals", () => {
    expect(() => deviceCalendarIntervals({ ...event, intervals: [[1, 2]] })).toThrow(
      ManualScheduleValidationError
    );
    expect(() =>
      deviceCalendarIntervals({
        ...event,
        intervals: [[at("2026-08-31", "09:00"), "later"]],
      })
    ).toThrow(ManualScheduleValidationError);
  });
});
