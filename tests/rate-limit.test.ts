import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clientIdentifier,
  consumeAll,
  consumeRateLimit,
  rateLimitHeaders,
  type RateLimitRule,
} from "@/lib/rate-limit";
import { CreateEventSchema, MAX_PARTICIPANTS, MAX_RANGE_DAYS } from "@/lib/validation";
import { resetDatabase, setupSchema } from "./helpers/db";

const RULE: RateLimitRule = { name: "test:rule", limit: 3, windowSeconds: 3600 };

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("consumeRateLimit", () => {
  it("allows requests up to the limit and refuses beyond it", async () => {
    const outcomes = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push((await consumeRateLimit(RULE, "203.0.113.7")).allowed);
    }
    expect(outcomes).toEqual([true, true, true, false, false]);
  });

  it("counts each identifier separately", async () => {
    for (let i = 0; i < 3; i++) await consumeRateLimit(RULE, "203.0.113.7");
    expect((await consumeRateLimit(RULE, "203.0.113.8")).allowed).toBe(true);
  });

  it("counts each rule separately", async () => {
    for (let i = 0; i < 3; i++) await consumeRateLimit(RULE, "203.0.113.7");
    const other: RateLimitRule = { ...RULE, name: "test:other" };
    expect((await consumeRateLimit(other, "203.0.113.7")).allowed).toBe(true);
  });

  it("reports remaining capacity", async () => {
    expect((await consumeRateLimit(RULE, "a")).remaining).toBe(2);
    expect((await consumeRateLimit(RULE, "a")).remaining).toBe(1);
    expect((await consumeRateLimit(RULE, "a")).remaining).toBe(0);
    expect((await consumeRateLimit(RULE, "a")).remaining).toBe(0);
  });

  it("holds under concurrent requests rather than letting them all through", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(RULE, "burst"))
    );
    expect(results.filter((result) => result.allowed).length).toBeLessThanOrEqual(
      RULE.limit
    );
  });

  it("never stores the raw identifier", async () => {
    await consumeRateLimit(RULE, "203.0.113.7");
    const { db } = await import("@/lib/db");
    const rows = await db.query.rateLimitBuckets.findMany({});
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toContain("203.0.113.7");
  });
});

describe("consumeAll", () => {
  it("stops at the first rule that refuses", async () => {
    const strict: RateLimitRule = { name: "test:strict", limit: 1, windowSeconds: 3600 };
    const loose: RateLimitRule = { name: "test:loose", limit: 99, windowSeconds: 3600 };

    expect((await consumeAll([{ rule: strict, identifier: "x" }])).allowed).toBe(true);
    const second = await consumeAll([
      { rule: strict, identifier: "x" },
      { rule: loose, identifier: "x" },
    ]);
    expect(second.allowed).toBe(false);
    expect(second.failed?.name).toBe("test:strict");
  });
});

describe("clientIdentifier", () => {
  it("uses the leftmost forwarded address", () => {
    const request = new Request("https://get2gethr.test/", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" },
    });
    expect(clientIdentifier(request)).toBe("203.0.113.7");
  });

  it("falls back through the other proxy headers", () => {
    expect(
      clientIdentifier(
        new Request("https://get2gethr.test/", { headers: { "x-real-ip": "198.51.100.1" } })
      )
    ).toBe("198.51.100.1");
  });

  it("degrades to a constant rather than throwing", () => {
    expect(clientIdentifier(new Request("https://get2gethr.test/"))).toBe("unknown");
  });
});

describe("rateLimitHeaders", () => {
  it("reports limit, remaining, and reset", () => {
    const headers = rateLimitHeaders({
      allowed: true,
      remaining: 2,
      limit: 5,
      resetAt: Math.floor(Date.now() / 1000) + 60,
    });
    expect(headers["RateLimit-Limit"]).toBe("5");
    expect(headers["RateLimit-Remaining"]).toBe("2");
    expect(Number(headers["RateLimit-Reset"])).toBeGreaterThan(0);
  });
});

describe("CreateEventSchema caps", () => {
  const valid = {
    title: "Weekly Sync",
    organizerEmail: "jane@example.com",
    organizerName: "Jane Smith",
    startDate: "2026-08-31",
    endDate: "2026-09-04",
    timezone: "America/New_York",
    durationMinutes: 60,
    workingHoursStart: "09:00",
    workingHoursEnd: "17:00",
    excludeWeekends: true,
    participantEmails: ["alex@example.com"],
  };

  it("accepts a well-formed request", () => {
    expect(CreateEventSchema.safeParse(valid).success).toBe(true);
  });

  it("caps the participant list", () => {
    const tooMany = Array.from(
      { length: MAX_PARTICIPANTS + 1 },
      (_, i) => `p${i}@example.com`
    );
    expect(
      CreateEventSchema.safeParse({ ...valid, participantEmails: tooMany }).success
    ).toBe(false);
  });

  it("requires at least one participant", () => {
    expect(
      CreateEventSchema.safeParse({ ...valid, participantEmails: [] }).success
    ).toBe(false);
  });

  it("caps the scheduling window", () => {
    expect(
      CreateEventSchema.safeParse({ ...valid, endDate: "2027-08-31" }).success
    ).toBe(false);
    expect(MAX_RANGE_DAYS).toBeLessThanOrEqual(365);
  });

  it("accepts a same-day window", () => {
    expect(
      CreateEventSchema.safeParse({ ...valid, endDate: "2026-08-31" }).success
    ).toBe(true);
  });

  it("rejects an inverted window", () => {
    expect(
      CreateEventSchema.safeParse({
        ...valid,
        startDate: "2026-09-04",
        endDate: "2026-08-31",
      }).success
    ).toBe(false);
  });

  it("rejects an unknown timezone", () => {
    expect(
      CreateEventSchema.safeParse({ ...valid, timezone: "America/Atlantis" }).success
    ).toBe(false);
  });

  it("rejects malformed working hours", () => {
    expect(
      CreateEventSchema.safeParse({ ...valid, workingHoursStart: "9am" }).success
    ).toBe(false);
    expect(
      CreateEventSchema.safeParse({
        ...valid,
        workingHoursStart: "17:00",
        workingHoursEnd: "09:00",
      }).success
    ).toBe(false);
  });

  it("rejects a meeting longer than the working day", () => {
    const result = CreateEventSchema.safeParse({ ...valid, durationMinutes: 480 + 15 });
    expect(result.success).toBe(false);
  });

  it("rejects a duplicated invitee", () => {
    expect(
      CreateEventSchema.safeParse({
        ...valid,
        participantEmails: ["alex@example.com", "Alex@example.com"],
      }).success
    ).toBe(false);
  });

  it("rejects the organizer inviting themselves twice over", () => {
    expect(
      CreateEventSchema.safeParse({
        ...valid,
        participantEmails: ["jane@example.com"],
      }).success
    ).toBe(false);
  });

  it("rejects malformed addresses", () => {
    expect(
      CreateEventSchema.safeParse({ ...valid, participantEmails: ["not-an-email"] })
        .success
    ).toBe(false);
  });

  it("caps title and description length", () => {
    expect(
      CreateEventSchema.safeParse({ ...valid, title: "x".repeat(201) }).success
    ).toBe(false);
    expect(
      CreateEventSchema.safeParse({ ...valid, description: "x".repeat(1001) }).success
    ).toBe(false);
  });

  it("reports every problem with a field path", () => {
    const result = CreateEventSchema.safeParse({ ...valid, title: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("title");
    }
  });
});
