import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MicrosoftCalendarBroker } from "@/lib/calendar/microsoft";
import type { CalendarGrant } from "@/lib/calendar";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function grant(overrides: Partial<CalendarGrant> = {}): CalendarGrant {
  return {
    broker: "microsoft",
    provider: "microsoft",
    accountEmail: "ian@example.com",
    brokerProfileId: null,
    brokerAccountId: "account-1",
    sourceCalendarIds: ["calendar-1"],
    destinationCalendarId: "calendar-1",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenExpiresAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

describe("MicrosoftCalendarBroker", () => {
  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = "client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "client-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
  });

  it("uses PKCE and least-privilege read scopes for attendees", async () => {
    const broker = new MicrosoftCalendarBroker();
    const redirect = await broker.buildAuthorizationUrl({
      state: "nonce",
      redirectUri: "https://finda.day/api/calendar/callback",
      needsWriteAccess: false,
      expectedEmail: "ian@example.com",
    });
    const url = new URL(redirect.url);
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toContain("Calendars.ReadBasic");
    expect(url.searchParams.get("scope")).not.toContain("Calendars.ReadWrite");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("login_hint")).toBe("ian@example.com");
    expect(redirect.codeVerifier).toBeTruthy();
  });

  it("requests write scope only for the organizer", async () => {
    const redirect = await new MicrosoftCalendarBroker().buildAuthorizationUrl({
      state: "nonce",
      redirectUri: "https://finda.day/api/calendar/callback",
      needsWriteAccess: true,
    });
    expect(new URL(redirect.url).searchParams.get("scope")).toContain(
      "Calendars.ReadWrite"
    );
  });

  it("exchanges a code and identifies the connected account", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "microsoft-user", mail: null, userPrincipalName: "ian@example.com" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new MicrosoftCalendarBroker().completeAuthorization({
      code: "authorization-code",
      redirectUri: "https://finda.day/api/calendar/callback",
      codeVerifier: "pkce-verifier",
    });
    expect(result).toMatchObject({
      broker: "microsoft",
      provider: "microsoft",
      accountEmail: "ian@example.com",
      brokerAccountId: "microsoft-user",
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    const tokenBody = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(tokenBody.get("code_verifier")).toBe("pkce-verifier");
  });

  it("rotates expired access and refresh tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          expires_in: 1800,
        })
      )
    );
    const result = await new MicrosoftCalendarBroker().refreshGrant(
      grant({ tokenExpiresAt: Date.now() - 1 })
    );
    expect(result.accessToken).toBe("rotated-access");
    expect(result.refreshToken).toBe("rotated-refresh");
    expect(result.tokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it("lists calendars without requesting event details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        value: [
          {
            id: "calendar-1",
            name: "Calendar",
            canEdit: true,
            isDefaultCalendar: true,
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const calendars = await new MicrosoftCalendarBroker().listCalendars(grant());
    expect(calendars).toEqual([
      {
        id: "calendar-1",
        name: "Calendar",
        writable: true,
        primary: true,
        provider: "microsoft",
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "$select=id,name,canEdit,isDefaultCalendar"
    );
  });

  it("creates an event in the event timezone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: "event-1", webLink: "https://outlook.test/event-1" })
    );
    vi.stubGlobal("fetch", fetchMock);

    await new MicrosoftCalendarBroker().createEvent(grant(), {
      idempotencyKey: "event-key",
      calendarId: "calendar-1",
      title: "dinner",
      startMs: Date.UTC(2026, 8, 2, 14, 0),
      endMs: Date.UTC(2026, 8, 2, 15, 0),
      timezone: "America/New_York",
      organizer: { email: "ian@example.com" },
      attendees: [{ email: "alex@example.com" }],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.start).toEqual({
      dateTime: "2026-09-02T10:00:00",
      timeZone: "America/New_York",
    });
  });

  it("derives merged busy intervals from calendarView for personal accounts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          value: [
            {
              start: { dateTime: "2026-09-02T13:00:00.0000000", timeZone: "UTC" },
              end: { dateTime: "2026-09-02T14:00:00.0000000", timeZone: "UTC" },
              showAs: "busy",
              isCancelled: false,
            },
            {
              start: { dateTime: "2026-09-02T14:00:00", timeZone: "UTC" },
              end: { dateTime: "2026-09-02T15:00:00", timeZone: "UTC" },
              showAs: "tentative",
              isCancelled: false,
            },
            {
              start: { dateTime: "2026-09-02T16:00:00", timeZone: "UTC" },
              end: { dateTime: "2026-09-02T17:00:00", timeZone: "UTC" },
              showAs: "free",
              isCancelled: false,
            },
          ],
        })
      )
    );
    const busy = await new MicrosoftCalendarBroker().getFreeBusy(grant(), {
      startMs: Date.UTC(2026, 8, 2, 0),
      endMs: Date.UTC(2026, 8, 3, 0),
    });
    expect(busy).toEqual([
      [Date.UTC(2026, 8, 2, 13), Date.UTC(2026, 8, 2, 15)],
    ]);
  });

  it("uses a stable Graph transaction id when creating an event", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { id: "event-1", webLink: "https://outlook.example/event-1" },
          201
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const broker = new MicrosoftCalendarBroker();
    const request = {
      idempotencyKey: "get2gethr-event-slot",
      calendarId: "calendar-1",
      title: "Planning",
      description: "Agenda",
      startMs: Date.UTC(2026, 8, 2, 13),
      endMs: Date.UTC(2026, 8, 2, 14),
      timezone: "America/New_York",
      organizer: { email: "ian@example.com" },
      attendees: [{ email: "alex@example.com", displayName: "Alex" }],
    };
    const first = await broker.createEvent(grant(), request);
    await broker.createEvent(grant(), request);
    expect(first.externalEventId).toBe("event-1");
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstBody.transactionId).toBe(secondBody.transactionId);
    expect(firstBody.start).toEqual({
      dateTime: "2026-09-02T09:00:00",
      timeZone: "America/New_York",
    });
    expect(firstBody.attendees[0].emailAddress.address).toBe("alex@example.com");
  });
});
