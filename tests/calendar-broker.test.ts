import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CalendarNotConfiguredError,
  FakeCalendarBroker,
  __setBrokerForTesting,
  connectionToGrant,
  getActiveBroker,
  getBroker,
  grantToConnectionFields,
  supportedProviders,
  type CalendarGrant,
} from "@/lib/calendar";
import { deterministicGoogleEventId } from "@/lib/calendar/google";
import { decrypt } from "@/lib/crypto";
import type { CalendarConnection } from "@/lib/db/schema";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "test-encryption-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("broker selection", () => {
  it("uses the explicitly configured broker", () => {
    process.env.CALENDAR_BROKER = "fake";
    expect(getActiveBroker().id).toBe("fake");
  });

  it("refuses an explicit broker whose credentials are missing", () => {
    process.env.CALENDAR_BROKER = "cronofy";
    delete process.env.CRONOFY_CLIENT_ID;
    delete process.env.CRONOFY_CLIENT_SECRET;
    expect(() => getActiveBroker()).toThrow(CalendarNotConfiguredError);
  });

  it("prefers Cronofy when it is configured, because it covers every provider", () => {
    delete process.env.CALENDAR_BROKER;
    process.env.CRONOFY_CLIENT_ID = "id";
    process.env.CRONOFY_CLIENT_SECRET = "secret";
    expect(getActiveBroker().id).toBe("cronofy");
  });

  it("falls back to direct Google when no broker is contracted", () => {
    delete process.env.CALENDAR_BROKER;
    delete process.env.CRONOFY_CLIENT_ID;
    delete process.env.CRONOFY_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(getActiveBroker().id).toBe("google");
  });

  it("routes a Microsoft choice to the direct Microsoft adapter", () => {
    delete process.env.CALENDAR_BROKER;
    process.env.MICROSOFT_CLIENT_ID = "id";
    process.env.MICROSOFT_CLIENT_SECRET = "secret";
    expect(getActiveBroker("microsoft").id).toBe("microsoft");
  });

  it("reports both direct providers when both are configured", () => {
    delete process.env.CALENDAR_BROKER;
    delete process.env.CRONOFY_CLIENT_ID;
    delete process.env.CRONOFY_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    process.env.MICROSOFT_CLIENT_ID = "microsoft-id";
    process.env.MICROSOFT_CLIENT_SECRET = "microsoft-secret";
    expect(supportedProviders()).toEqual(["google", "microsoft"]);
  });

  it("refuses rather than building an authorization URL with no credentials", () => {
    delete process.env.CALENDAR_BROKER;
    delete process.env.CRONOFY_CLIENT_ID;
    delete process.env.CRONOFY_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    expect(() => getActiveBroker()).toThrow(CalendarNotConfiguredError);
  });

  it("reports the providers the active broker can actually connect", () => {
    process.env.CALENDAR_BROKER = "cronofy";
    process.env.CRONOFY_CLIENT_ID = "id";
    process.env.CRONOFY_CLIENT_SECRET = "secret";
    expect(supportedProviders()).toEqual(
      expect.arrayContaining(["google", "microsoft", "apple", "exchange"])
    );

    process.env.CALENDAR_BROKER = "google";
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    // The honest answer for direct Google: Microsoft and Apple users cannot
    // connect at all, which is the whole argument for a broker.
    expect(supportedProviders()).toEqual(["google"]);
  });
});

describe("Cronofy adapter", () => {
  beforeEach(() => {
    process.env.CRONOFY_CLIENT_ID = "id";
    process.env.CRONOFY_CLIENT_SECRET = "secret";
    delete process.env.CRONOFY_DATA_CENTER;
  });

  it("builds an authorization URL against the default data centre", async () => {
    const redirect = await getBroker("cronofy").buildAuthorizationUrl({
      state: "nonce-123",
      redirectUri: "https://get2gethr.test/api/calendar/callback",
      needsWriteAccess: false,
    });
    const url = new URL(redirect.url);
    expect(url.origin).toBe("https://app.cronofy.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("state")).toBe("nonce-123");
    expect(url.searchParams.get("client_id")).toBe("id");
  });

  it("honours a data-centre selection, which matters for data residency", async () => {
    process.env.CRONOFY_DATA_CENTER = "de";
    const redirect = await getBroker("cronofy").buildAuthorizationUrl({
      state: "n",
      redirectUri: "https://get2gethr.test/api/calendar/callback",
      needsWriteAccess: false,
    });
    expect(new URL(redirect.url).origin).toBe("https://app-de.cronofy.com");
  });

  it("asks only for free/busy for an attendee", async () => {
    const redirect = await getBroker("cronofy").buildAuthorizationUrl({
      state: "n",
      redirectUri: "https://get2gethr.test/api/calendar/callback",
      needsWriteAccess: false,
    });
    expect(new URL(redirect.url).searchParams.get("scope")).toBe("free_busy");
  });

  it("asks for write access only for the organizer, who hosts the meeting", async () => {
    const redirect = await getBroker("cronofy").buildAuthorizationUrl({
      state: "n",
      redirectUri: "https://get2gethr.test/api/calendar/callback",
      needsWriteAccess: true,
    });
    expect(new URL(redirect.url).searchParams.get("scope")).toBe("free_busy_write");
  });
});

describe("deterministicGoogleEventId", () => {
  it("is stable for the same key, which is what makes retries idempotent", () => {
    expect(deterministicGoogleEventId("event-1-slot-1")).toBe(
      deterministicGoogleEventId("event-1-slot-1")
    );
  });

  it("differs for different keys", () => {
    expect(deterministicGoogleEventId("a")).not.toBe(deterministicGoogleEventId("b"));
  });

  it("uses only characters Google accepts in an event id", () => {
    // base32hex: digits 0-9 and lowercase a-v, at least five characters.
    const id = deterministicGoogleEventId("get2gethr-event-slot");
    expect(id).toMatch(/^[0-9a-v]+$/);
    expect(id.length).toBeGreaterThanOrEqual(5);
    expect(id.length).toBeLessThanOrEqual(1024);
  });
});

describe("grant storage", () => {
  const grant: CalendarGrant = {
    broker: "fake",
    provider: "google",
    accountEmail: "alex@example.com",
    brokerProfileId: "profile-1",
    brokerAccountId: "account-1",
    sourceCalendarIds: ["cal-a", "cal-b"],
    destinationCalendarId: "cal-a",
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    tokenExpiresAt: 1_800_000_000,
  };

  it("encrypts credentials before they are stored", () => {
    const fields = grantToConnectionFields(grant);
    expect(fields.accessToken).not.toBe("access-secret");
    expect(fields.refreshToken).not.toBe("refresh-secret");
    expect(fields.accessToken!.startsWith("v2:")).toBe(true);
    expect(decrypt(fields.accessToken!)).toBe("access-secret");
  });

  it("round-trips a grant through storage", () => {
    const fields = grantToConnectionFields(grant);
    const row = {
      ...fields,
      id: "conn-1",
      participantId: "p-1",
      status: "connected",
      lastSyncedAt: null,
      lastError: null,
      createdAt: 0,
      updatedAt: 0,
    } as unknown as CalendarConnection;

    expect(connectionToGrant(row)).toEqual(grant);
  });

  it("survives a corrupt calendar list rather than throwing", () => {
    const row = {
      ...grantToConnectionFields(grant),
      sourceCalendarIds: "not json",
      id: "conn-1",
      participantId: "p-1",
      status: "connected",
      lastSyncedAt: null,
      lastError: null,
      createdAt: 0,
      updatedAt: 0,
    } as unknown as CalendarConnection;

    expect(connectionToGrant(row).sourceCalendarIds).toEqual([]);
  });

  it("leaves credentials null when a broker holds its own tokens", () => {
    const brokered: CalendarGrant = {
      ...grant,
      accessToken: null,
      refreshToken: null,
    };
    const fields = grantToConnectionFields(brokered);
    expect(fields.accessToken).toBeNull();
    expect(fields.refreshToken).toBeNull();
  });
});

describe("FakeCalendarBroker", () => {
  it("deduplicates an event written twice with the same key", async () => {
    const broker = new FakeCalendarBroker();
    const restore = __setBrokerForTesting("fake", broker);
    broker.registerAccount("code", { email: "jane@example.com" });

    const grant = await broker.completeAuthorization({
      code: "code",
      redirectUri: "https://get2gethr.test/cb",
    });

    const request = {
      idempotencyKey: "get2gethr-e1-s1",
      calendarId: "jane@example.com:primary",
      title: "Sync",
      startMs: Date.UTC(2026, 8, 1, 13),
      endMs: Date.UTC(2026, 8, 1, 14),
      timezone: "UTC",
      organizer: { email: "jane@example.com" },
      attendees: [],
    };

    const first = await broker.createEvent(grant, request);
    const second = await broker.createEvent(grant, request);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(broker.createdEvents.size).toBe(1);
    restore();
  });
});
