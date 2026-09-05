import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  enumerateLocalDates,
  isValidLocalDate,
  isValidTimeZone,
  localDateDifferenceInDays,
  localDateRangeToUtcBounds,
  localDateWeekday,
  parseHourMinute,
  parseWorkingHours,
  TimeValidationError,
  timeZoneOffsetMs,
  utcMsToLocalDate,
  zonedWallClockToUtcMs,
} from "@/lib/time";

const HOUR = 60 * 60 * 1000;

describe("timezone validation", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Pacific/Auckland")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects invented zones and non-strings", () => {
    expect(isValidTimeZone("America/Atlantis")).toBe(false);
    expect(isValidTimeZone("EST5EDT-nonsense")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe("local date parsing", () => {
  it("accepts well-formed calendar dates", () => {
    expect(isValidLocalDate("2026-08-31")).toBe(true);
    expect(isValidLocalDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects impossible dates that match the shape", () => {
    expect(isValidLocalDate("2025-02-30")).toBe(false);
    expect(isValidLocalDate("2025-02-29")).toBe(false); // not a leap year
    expect(isValidLocalDate("2025-13-01")).toBe(false);
    expect(isValidLocalDate("2025-00-10")).toBe(false);
    expect(isValidLocalDate("2025-1-1")).toBe(false);
    expect(isValidLocalDate("not-a-date")).toBe(false);
  });
});

describe("working hours parsing", () => {
  it("converts HH:mm to minutes from midnight", () => {
    expect(parseHourMinute("00:00")).toBe(0);
    expect(parseHourMinute("09:30")).toBe(570);
    expect(parseHourMinute("23:59")).toBe(1439);
  });

  it("allows 24:00 only as an end-of-day marker", () => {
    expect(parseHourMinute("24:00", { allowEndOfDay: true })).toBe(1440);
    expect(() => parseHourMinute("24:00")).toThrow(TimeValidationError);
  });

  it("rejects malformed and out-of-range times", () => {
    expect(() => parseHourMinute("9:00")).toThrow(TimeValidationError);
    expect(() => parseHourMinute("09:60")).toThrow(TimeValidationError);
    expect(() => parseHourMinute("25:00")).toThrow(TimeValidationError);
    expect(() => parseHourMinute("24:30", { allowEndOfDay: true })).toThrow(
      TimeValidationError
    );
  });

  it("accepts a window that runs to midnight", () => {
    expect(parseWorkingHours("09:00", "24:00")).toEqual({
      startMinutes: 540,
      endMinutes: 1440,
    });
  });

  it("accepts a window that starts at midnight", () => {
    expect(parseWorkingHours("00:00", "08:00")).toEqual({
      startMinutes: 0,
      endMinutes: 480,
    });
  });

  it("rejects empty and inverted windows rather than reinterpreting them", () => {
    expect(() => parseWorkingHours("17:00", "09:00")).toThrow(TimeValidationError);
    expect(() => parseWorkingHours("09:00", "09:00")).toThrow(TimeValidationError);
  });
});

describe("calendar date arithmetic", () => {
  it("crosses month boundaries", () => {
    expect(addLocalDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addLocalDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses year boundaries", () => {
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles leap days", () => {
    expect(addLocalDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addLocalDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("reports weekdays with Sunday as zero", () => {
    expect(localDateWeekday("2026-08-30")).toBe(0); // Sunday
    expect(localDateWeekday("2026-08-31")).toBe(1); // Monday
    expect(localDateWeekday("2026-09-05")).toBe(6); // Saturday
  });

  it("measures inclusive spans", () => {
    expect(localDateDifferenceInDays("2026-08-31", "2026-08-31")).toBe(0);
    expect(localDateDifferenceInDays("2026-08-31", "2026-09-04")).toBe(4);
    expect(localDateDifferenceInDays("2026-09-04", "2026-08-31")).toBe(-4);
  });
});

describe("enumerateLocalDates", () => {
  it("includes both endpoints", () => {
    expect(enumerateLocalDates("2026-08-31", "2026-09-04")).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]);
  });

  it("returns a single day for a same-day range", () => {
    expect(enumerateLocalDates("2026-08-31", "2026-08-31")).toEqual(["2026-08-31"]);
  });

  it("visits a spring-forward day exactly once", () => {
    // 2026-03-08 is the US spring-forward day; that day is only 23 hours long.
    const dates = enumerateLocalDates("2026-03-06", "2026-03-10");
    expect(dates).toEqual([
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("visits a fall-back day exactly once", () => {
    // 2026-11-01 is the US fall-back day; that day is 25 hours long.
    const dates = enumerateLocalDates("2026-10-30", "2026-11-03");
    expect(dates).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
  });

  it("rejects an inverted range", () => {
    expect(() => enumerateLocalDates("2026-09-04", "2026-08-31")).toThrow(
      TimeValidationError
    );
  });
});

describe("zonedWallClockToUtcMs", () => {
  it("maps a wall-clock time in a negative-offset zone", () => {
    // 2026-08-31 09:00 EDT (UTC-4) === 13:00 UTC
    const ms = zonedWallClockToUtcMs("2026-08-31", 9 * 60, "America/New_York");
    expect(new Date(ms).toISOString()).toBe("2026-08-31T13:00:00.000Z");
  });

  it("maps a wall-clock time in a positive-offset zone", () => {
    // 2026-08-31 09:00 JST (UTC+9) === 2026-08-31 00:00 UTC
    const ms = zonedWallClockToUtcMs("2026-08-31", 9 * 60, "Asia/Tokyo");
    expect(new Date(ms).toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("maps a half-hour offset zone", () => {
    // 2026-08-31 09:00 IST (UTC+5:30) === 2026-08-31 03:30 UTC
    const ms = zonedWallClockToUtcMs("2026-08-31", 9 * 60, "Asia/Kolkata");
    expect(new Date(ms).toISOString()).toBe("2026-08-31T03:30:00.000Z");
  });

  it("applies standard time before and daylight time after a spring transition", () => {
    const before = zonedWallClockToUtcMs("2026-03-07", 9 * 60, "America/New_York");
    const after = zonedWallClockToUtcMs("2026-03-09", 9 * 60, "America/New_York");
    expect(new Date(before).toISOString()).toBe("2026-03-07T14:00:00.000Z"); // EST
    expect(new Date(after).toISOString()).toBe("2026-03-09T13:00:00.000Z"); // EDT
  });

  it("applies daylight time before and standard time after a fall transition", () => {
    const before = zonedWallClockToUtcMs("2026-10-31", 9 * 60, "America/New_York");
    const after = zonedWallClockToUtcMs("2026-11-02", 9 * 60, "America/New_York");
    expect(new Date(before).toISOString()).toBe("2026-10-31T13:00:00.000Z"); // EDT
    expect(new Date(after).toISOString()).toBe("2026-11-02T14:00:00.000Z"); // EST
  });

  it("resolves a nonexistent spring-forward wall clock forward past the gap", () => {
    // 02:30 on 2026-03-08 does not exist in New York; it resolves to 03:30 EDT.
    const ms = zonedWallClockToUtcMs("2026-03-08", 2 * 60 + 30, "America/New_York");
    expect(new Date(ms).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("resolves an ambiguous fall-back wall clock to the first occurrence", () => {
    // 01:30 on 2026-11-01 happens twice in New York; we take the EDT one.
    const ms = zonedWallClockToUtcMs("2026-11-01", 90, "America/New_York");
    expect(new Date(ms).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("handles a southern-hemisphere zone whose DST runs the other way", () => {
    const january = zonedWallClockToUtcMs("2026-01-15", 9 * 60, "Australia/Sydney");
    const july = zonedWallClockToUtcMs("2026-07-15", 9 * 60, "Australia/Sydney");
    expect(new Date(january).toISOString()).toBe("2026-01-14T22:00:00.000Z"); // AEDT +11
    expect(new Date(july).toISOString()).toBe("2026-07-14T23:00:00.000Z"); // AEST +10
  });
});

describe("timeZoneOffsetMs", () => {
  it("reports the offset in effect at the given instant", () => {
    const summer = Date.UTC(2026, 6, 1, 12);
    const winter = Date.UTC(2026, 0, 1, 12);
    expect(timeZoneOffsetMs(summer, "America/New_York")).toBe(-4 * HOUR);
    expect(timeZoneOffsetMs(winter, "America/New_York")).toBe(-5 * HOUR);
    expect(timeZoneOffsetMs(summer, "UTC")).toBe(0);
  });
});

describe("localDateRangeToUtcBounds", () => {
  it("makes the latest date inclusive by ending at the next midnight", () => {
    const { startMs, endMs } = localDateRangeToUtcBounds(
      "2026-08-31",
      "2026-09-04",
      "America/New_York"
    );
    expect(new Date(startMs).toISOString()).toBe("2026-08-31T04:00:00.000Z");
    // The full day of Sep 4 is inside the window.
    expect(new Date(endMs).toISOString()).toBe("2026-09-05T04:00:00.000Z");
  });

  it("gives a same-day range a full usable day", () => {
    const { startMs, endMs } = localDateRangeToUtcBounds(
      "2026-08-31",
      "2026-08-31",
      "America/New_York"
    );
    expect(endMs - startMs).toBe(24 * HOUR);
  });

  it("keeps a 5pm slot on the final date inside the window", () => {
    const { endMs } = localDateRangeToUtcBounds(
      "2026-08-31",
      "2026-09-04",
      "America/New_York"
    );
    const lastAfternoon = zonedWallClockToUtcMs(
      "2026-09-04",
      17 * 60,
      "America/New_York"
    );
    expect(lastAfternoon).toBeLessThan(endMs);
  });

  it("works in a positive-offset zone", () => {
    const { startMs, endMs } = localDateRangeToUtcBounds(
      "2026-08-31",
      "2026-08-31",
      "Asia/Tokyo"
    );
    expect(new Date(startMs).toISOString()).toBe("2026-08-30T15:00:00.000Z");
    expect(new Date(endMs).toISOString()).toBe("2026-08-31T15:00:00.000Z");
  });

  it("spans 23 hours across a spring-forward day", () => {
    const { startMs, endMs } = localDateRangeToUtcBounds(
      "2026-03-08",
      "2026-03-08",
      "America/New_York"
    );
    expect(endMs - startMs).toBe(23 * HOUR);
  });

  it("spans 25 hours across a fall-back day", () => {
    const { startMs, endMs } = localDateRangeToUtcBounds(
      "2026-11-01",
      "2026-11-01",
      "America/New_York"
    );
    expect(endMs - startMs).toBe(25 * HOUR);
  });

  it("crosses a month boundary", () => {
    const { startMs, endMs } = localDateRangeToUtcBounds(
      "2026-01-30",
      "2026-02-02",
      "Europe/London"
    );
    expect(utcMsToLocalDate(startMs, "Europe/London")).toBe("2026-01-30");
    expect(utcMsToLocalDate(endMs - 1, "Europe/London")).toBe("2026-02-02");
  });

  it("rejects an inverted range", () => {
    expect(() =>
      localDateRangeToUtcBounds("2026-09-04", "2026-08-31", "UTC")
    ).toThrow(TimeValidationError);
  });

  it("rejects an unknown timezone", () => {
    expect(() =>
      localDateRangeToUtcBounds("2026-08-31", "2026-09-04", "America/Atlantis")
    ).toThrow(TimeValidationError);
  });
});

describe("utcMsToLocalDate", () => {
  it("reports the local date, not the UTC date", () => {
    // 2026-09-01 01:00 UTC is still 2026-08-31 in New York.
    const ms = Date.UTC(2026, 8, 1, 1, 0);
    expect(utcMsToLocalDate(ms, "UTC")).toBe("2026-09-01");
    expect(utcMsToLocalDate(ms, "America/New_York")).toBe("2026-08-31");
    expect(utcMsToLocalDate(ms, "Asia/Tokyo")).toBe("2026-09-01");
  });
});
