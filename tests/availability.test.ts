import { describe, expect, it } from "vitest";
import {
  computeCandidateSlots,
  isSlotStillFree,
  mergeBusy,
  overlapsBusy,
  type CandidateSlotRequest,
  type Interval,
} from "@/lib/availability";
import { zonedWallClockToUtcMs } from "@/lib/time";
import {
  blankWeeklyAvailability,
  weeklySlotIndex,
  type WeeklySlotState,
} from "@/lib/weekly-availability";

const NY = "America/New_York";

/** A 9-to-5, weekdays-only, one-hour-meeting request with nobody busy. */
function baseRequest(overrides: Partial<CandidateSlotRequest> = {}): CandidateSlotRequest {
  return {
    startDate: "2026-08-31", // Monday
    endDate: "2026-09-04", // Friday
    timezone: NY,
    durationMinutes: 60,
    workingHoursStart: "09:00",
    workingHoursEnd: "17:00",
    excludeWeekends: true,
    busyByParticipant: [],
    ...overrides,
  };
}

/** Reads a slot back as a wall clock in the request timezone. */
function wall(ms: number, tz = NY): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(ms))
    .replace(", ", " ");
}

function at(date: string, time: string, tz = NY): number {
  const [h, m] = time.split(":").map(Number);
  return zonedWallClockToUtcMs(date, h * 60 + m, tz);
}

describe("mergeBusy", () => {
  it("merges overlapping intervals", () => {
    expect(mergeBusy([[10, 20], [15, 30]])).toEqual([[10, 30]]);
  });

  it("merges intervals that only touch", () => {
    expect(mergeBusy([[10, 20], [20, 30]])).toEqual([[10, 30]]);
  });

  it("keeps disjoint intervals separate and sorted", () => {
    expect(mergeBusy([[40, 50], [10, 20]])).toEqual([[10, 20], [40, 50]]);
  });

  it("swallows an interval fully contained in another", () => {
    expect(mergeBusy([[10, 50], [20, 30]])).toEqual([[10, 50]]);
  });

  it("drops empty and inverted intervals", () => {
    expect(mergeBusy([[10, 10], [30, 20]])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input: Interval[] = [[10, 20], [15, 30]];
    mergeBusy(input);
    expect(input).toEqual([[10, 20], [15, 30]]);
  });
});

describe("overlapsBusy", () => {
  const busy = mergeBusy([[100, 200], [300, 400]]);

  it("treats intervals as half-open, so touching is not overlapping", () => {
    expect(overlapsBusy(50, 100, busy)).toBe(false);
    expect(overlapsBusy(200, 300, busy)).toBe(false);
  });

  it("detects partial and full overlap", () => {
    expect(overlapsBusy(150, 250, busy)).toBe(true);
    expect(overlapsBusy(90, 500, busy)).toBe(true);
    expect(overlapsBusy(120, 180, busy)).toBe(true);
  });
});

describe("computeCandidateSlots — window boundaries", () => {
  it("produces slots on every weekday of an inclusive range", () => {
    const slots = computeCandidateSlots(baseRequest());
    const days = new Set(slots.map(([start]) => wall(start).slice(0, 10)));
    expect([...days].sort()).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]);
  });

  it("keeps the full working day of the latest date", () => {
    const slots = computeCandidateSlots(baseRequest());
    const lastDay = slots.filter(([start]) => wall(start).startsWith("2026-09-04"));
    expect(wall(lastDay[0][0])).toBe("2026-09-04 09:00");
    expect(wall(lastDay[lastDay.length - 1][0])).toBe("2026-09-04 16:00");
  });

  it("starts at the working-hours start, not at midnight", () => {
    const slots = computeCandidateSlots(baseRequest());
    expect(wall(slots[0][0])).toBe("2026-08-31 09:00");
  });

  it("never lets a slot end past the working-hours end", () => {
    const slots = computeCandidateSlots(baseRequest());
    for (const [, end] of slots) {
      expect(Number(wall(end).slice(11, 13))).toBeLessThanOrEqual(17);
    }
  });

  it("supports a same-day window", () => {
    const slots = computeCandidateSlots(
      baseRequest({ startDate: "2026-08-31", endDate: "2026-08-31" })
    );
    expect(slots).toHaveLength(15); // 09:00 through 16:00 every 30 minutes
    expect(wall(slots[0][0])).toBe("2026-08-31 09:00");
    expect(wall(slots[14][0])).toBe("2026-08-31 16:00");
  });

  it("supports a window that crosses a month boundary", () => {
    const slots = computeCandidateSlots(
      baseRequest({ startDate: "2026-01-30", endDate: "2026-02-02" })
    );
    const days = [...new Set(slots.map(([s]) => wall(s).slice(0, 10)))].sort();
    // Jan 31 and Feb 1 are a weekend and correctly dropped.
    expect(days).toEqual(["2026-01-30", "2026-02-02"]);
  });

  it("returns nothing when the meeting is longer than the working day", () => {
    expect(
      computeCandidateSlots(baseRequest({ durationMinutes: 600 }))
    ).toEqual([]);
  });

  it("returns exactly one slot when the meeting fills the working day", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        durationMinutes: 480,
      })
    );
    expect(slots).toHaveLength(1);
    expect(wall(slots[0][0])).toBe("2026-08-31 09:00");
    expect(wall(slots[0][1])).toBe("2026-08-31 17:00");
  });
});

describe("computeCandidateSlots — working windows touching midnight", () => {
  it("handles a window that runs to 24:00", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        workingHoursStart: "22:00",
        workingHoursEnd: "24:00",
      })
    );
    expect(slots.map(([s]) => wall(s))).toEqual([
      "2026-08-31 22:00",
      "2026-08-31 22:30",
      "2026-08-31 23:00",
    ]);
    expect(wall(slots[2][1])).toBe("2026-09-01 00:00");
  });

  it("handles a window that starts at 00:00", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        workingHoursStart: "00:00",
        workingHoursEnd: "02:00",
      })
    );
    expect(slots.map(([s]) => wall(s))).toEqual([
      "2026-08-31 00:00",
      "2026-08-31 00:30",
      "2026-08-31 01:00",
    ]);
  });

  it("rejects an inverted working window instead of wrapping it", () => {
    expect(() =>
      computeCandidateSlots(
        baseRequest({ workingHoursStart: "17:00", workingHoursEnd: "09:00" })
      )
    ).toThrow(/must be after/);
  });
});

describe("computeCandidateSlots — timezone offsets", () => {
  it("anchors slots to the wall clock in a negative-offset zone", () => {
    const slots = computeCandidateSlots(
      baseRequest({ startDate: "2026-08-31", endDate: "2026-08-31" })
    );
    expect(new Date(slots[0][0]).toISOString()).toBe("2026-08-31T13:00:00.000Z");
  });

  it("anchors slots to the wall clock in a positive-offset zone", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        timezone: "Asia/Tokyo",
      })
    );
    expect(new Date(slots[0][0]).toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(wall(slots[0][0], "Asia/Tokyo")).toBe("2026-08-31 09:00");
  });

  it("anchors slots correctly in a 45-minute-offset zone", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        timezone: "Asia/Kathmandu",
      })
    );
    // Snapping is relative to the working-hours start in local time, so the
    // first slot is 09:00 local even though that is 03:15 UTC.
    expect(wall(slots[0][0], "Asia/Kathmandu")).toBe("2026-08-31 09:00");
    expect(new Date(slots[0][0]).toISOString()).toBe("2026-08-31T03:15:00.000Z");
  });

  it("produces the same local wall clocks regardless of the sign of the offset", () => {
    const east = computeCandidateSlots(
      baseRequest({ startDate: "2026-08-31", endDate: "2026-08-31", timezone: "Asia/Tokyo" })
    );
    const west = computeCandidateSlots(
      baseRequest({ startDate: "2026-08-31", endDate: "2026-08-31", timezone: "America/Los_Angeles" })
    );
    expect(east.map(([s]) => wall(s, "Asia/Tokyo").slice(11))).toEqual(
      west.map(([s]) => wall(s, "America/Los_Angeles").slice(11))
    );
  });
});

describe("computeCandidateSlots — daylight saving", () => {
  it("keeps the working window on a spring-forward day", () => {
    // 2026-03-08 is a Sunday, so use the surrounding week with weekends allowed.
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-03-08",
        endDate: "2026-03-08",
        excludeWeekends: false,
      })
    );
    expect(wall(slots[0][0])).toBe("2026-03-08 09:00");
    expect(wall(slots[slots.length - 1][1])).toBe("2026-03-08 17:00");
    expect(slots).toHaveLength(15);
  });

  it("keeps the working window on a fall-back day", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-11-01",
        endDate: "2026-11-01",
        excludeWeekends: false,
      })
    );
    expect(wall(slots[0][0])).toBe("2026-11-01 09:00");
    expect(wall(slots[slots.length - 1][1])).toBe("2026-11-01 17:00");
    expect(slots).toHaveLength(15);
  });

  it("does not skip or duplicate a day across a spring transition", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-03-06",
        endDate: "2026-03-10",
        excludeWeekends: false,
      })
    );
    const days = [...new Set(slots.map(([s]) => wall(s).slice(0, 10)))];
    expect(days).toEqual([
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
  });

  it("drops slots that a spring-forward gap swallows", () => {
    // An overnight-adjacent window covering the 02:00-03:00 gap in New York.
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-03-08",
        endDate: "2026-03-08",
        excludeWeekends: false,
        workingHoursStart: "01:00",
        workingHoursEnd: "05:00",
        durationMinutes: 60,
      })
    );
    // 02:00 and 02:30 do not exist; they resolve to 03:00, so the surviving
    // starts are the real ones and none of them ends after 05:00.
    for (const [start, end] of slots) {
      expect(end - start).toBe(60 * 60 * 1000);
      expect(end).toBeLessThanOrEqual(at("2026-03-08", "05:00"));
    }
    expect(slots.map(([s]) => wall(s))).toContain("2026-03-08 01:00");
    expect(slots.map(([s]) => wall(s))).not.toContain("2026-03-08 02:00");
  });
});

describe("computeCandidateSlots — weekends", () => {
  it("excludes Saturday and Sunday by default", () => {
    const slots = computeCandidateSlots(
      baseRequest({ startDate: "2026-09-05", endDate: "2026-09-06" })
    );
    expect(slots).toEqual([]);
  });

  it("includes weekends when asked", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-09-05",
        endDate: "2026-09-06",
        excludeWeekends: false,
      })
    );
    const days = [...new Set(slots.map(([s]) => wall(s).slice(0, 10)))];
    expect(days).toEqual(["2026-09-05", "2026-09-06"]);
  });

  it("uses the weekday in the event timezone, not UTC", () => {
    // Monday 2026-08-31 09:00 in Auckland is Sunday 21:00 UTC.
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        timezone: "Pacific/Auckland",
      })
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(new Date(slots[0][0]).getUTCDay()).toBe(0); // Sunday in UTC
  });
});

describe("computeCandidateSlots — busy time", () => {
  it("removes slots that overlap a single participant's meeting", () => {
    const busy: Interval[] = [[at("2026-08-31", "10:00"), at("2026-08-31", "11:00")]];
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        busyByParticipant: [busy],
      })
    );
    const starts = slots.map(([s]) => wall(s));
    expect(starts).not.toContain("2026-08-31 09:30");
    expect(starts).not.toContain("2026-08-31 10:00");
    expect(starts).not.toContain("2026-08-31 10:30");
    expect(starts).toContain("2026-08-31 09:00"); // ends exactly at 10:00
    expect(starts).toContain("2026-08-31 11:00"); // starts exactly at 11:00
  });

  it("takes the union of every participant's busy time", () => {
    const alex: Interval[] = [[at("2026-08-31", "09:00"), at("2026-08-31", "12:00")]];
    const sam: Interval[] = [[at("2026-08-31", "13:00"), at("2026-08-31", "17:00")]];
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        busyByParticipant: [alex, sam],
      })
    );
    expect(slots.map(([s]) => wall(s))).toEqual(["2026-08-31 12:00"]);
  });

  it("merges multiple calendars belonging to one participant", () => {
    const workAndPersonal: Interval[] = [
      [at("2026-08-31", "09:00"), at("2026-08-31", "12:00")],
      [at("2026-08-31", "11:30"), at("2026-08-31", "16:00")],
    ];
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        busyByParticipant: [workAndPersonal],
      })
    );
    expect(slots.map(([s]) => wall(s))).toEqual(["2026-08-31 16:00"]);
  });

  it("returns nothing when everyone is busy all window", () => {
    const allDay: Interval[] = [
      [at("2026-08-31", "00:00"), at("2026-09-05", "00:00")],
    ];
    expect(
      computeCandidateSlots(baseRequest({ busyByParticipant: [allDay] }))
    ).toEqual([]);
  });

  it("treats a participant with no busy time as free", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        busyByParticipant: [[], [], []],
      })
    );
    expect(slots).toHaveLength(15);
  });
});

describe("computeCandidateSlots — determinism and ordering", () => {
  it("returns slots in strictly increasing start order", () => {
    const slots = computeCandidateSlots(baseRequest());
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i][0]).toBeGreaterThan(slots[i - 1][0]);
    }
  });

  it("produces an identical list on repeated runs", () => {
    const request = baseRequest({
      busyByParticipant: [
        [[at("2026-09-01", "10:00"), at("2026-09-01", "11:00")]],
        [[at("2026-09-02", "14:00"), at("2026-09-02", "15:00")]],
      ],
    });
    expect(computeCandidateSlots(request)).toEqual(computeCandidateSlots(request));
  });

  it("does not depend on the order participants are supplied in", () => {
    const alex: Interval[] = [[at("2026-09-01", "10:00"), at("2026-09-01", "11:00")]];
    const sam: Interval[] = [[at("2026-09-02", "14:00"), at("2026-09-02", "15:00")]];
    expect(
      computeCandidateSlots(baseRequest({ busyByParticipant: [alex, sam] }))
    ).toEqual(
      computeCandidateSlots(baseRequest({ busyByParticipant: [sam, alex] }))
    );
  });
});

describe("computeCandidateSlots — weekly planner", () => {
  function closedWeek(): WeeklySlotState[] {
    return blankWeeklyAvailability().map(() => "unavailable");
  }

  it("removes unavailable hours", () => {
    const week = closedWeek();
    week[weeklySlotIndex(0, 10)] = "available";

    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        durationMinutes: 60,
        weeklyAvailability: week,
      })
    );

    expect(slots.map(([start]) => wall(start).slice(11))).toEqual(["10:00"]);
  });

  it("ranks preferred times before earlier merely available times", () => {
    const week = closedWeek();
    week[weeklySlotIndex(0, 10)] = "available";
    week[weeklySlotIndex(1, 10)] = "preferred";

    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-09-01",
        durationMinutes: 60,
        weeklyAvailability: week,
      })
    );

    expect(slots.map(([start]) => wall(start))).toEqual([
      "2026-09-01 10:00",
      "2026-08-31 10:00",
    ]);
  });

  it("uses the planner for weekends instead of the legacy weekend switch", () => {
    const week = closedWeek();
    week[weeklySlotIndex(6, 12)] = "preferred";

    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-09-06",
        endDate: "2026-09-06",
        durationMinutes: 60,
        excludeWeekends: true,
        weeklyAvailability: week,
      })
    );

    expect(slots.map(([start]) => wall(start))).toEqual(["2026-09-06 12:00"]);
  });
});

describe("computeCandidateSlots — floors and caps", () => {
  it("drops slots that start before notBeforeMs", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        notBeforeMs: at("2026-08-31", "14:00"),
      })
    );
    expect(wall(slots[0][0])).toBe("2026-08-31 14:00");
  });

  it("honours a slot cap", () => {
    const slots = computeCandidateSlots(baseRequest({ maxSlots: 7 }));
    expect(slots).toHaveLength(7);
  });

  it("honours a custom granularity", () => {
    const slots = computeCandidateSlots(
      baseRequest({
        startDate: "2026-08-31",
        endDate: "2026-08-31",
        granularityMinutes: 60,
      })
    );
    expect(slots.map(([s]) => wall(s).slice(11))).toEqual([
      "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00",
    ]);
  });

  it("rejects a non-positive duration", () => {
    expect(() => computeCandidateSlots(baseRequest({ durationMinutes: 0 }))).toThrow();
  });
});

describe("isSlotStillFree", () => {
  const slot: Interval = [at("2026-08-31", "10:00"), at("2026-08-31", "11:00")];

  it("is true when nobody has become busy", () => {
    expect(isSlotStillFree(slot, [[], []])).toBe(true);
  });

  it("is false once someone books over the slot", () => {
    const newMeeting: Interval[] = [
      [at("2026-08-31", "10:30"), at("2026-08-31", "10:45")],
    ];
    expect(isSlotStillFree(slot, [[], newMeeting])).toBe(false);
  });

  it("is true for a booking that merely abuts the slot", () => {
    const abutting: Interval[] = [
      [at("2026-08-31", "09:00"), at("2026-08-31", "10:00")],
      [at("2026-08-31", "11:00"), at("2026-08-31", "12:00")],
    ];
    expect(isSlotStillFree(slot, [abutting])).toBe(true);
  });
});
