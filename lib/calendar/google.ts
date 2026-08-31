import crypto from "node:crypto";
import { google } from "googleapis";
import type { Interval } from "../availability";
import { mergeBusy } from "../availability";
import {
  CalendarAuthorizationError,
  CalendarTransientError,
  type AuthorizationCallback,
  type AuthorizationRedirect,
  type AuthorizationRequest,
  type CalendarBroker,
  type CalendarEventRequest,
  type CalendarEventResult,
  type CalendarGrant,
  type CalendarProviderId,
  type CalendarSummary,
  type FreeBusyRequest,
} from "./types";

/** Attendees only ever share busy time; nothing here can read event details. */
const READ_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "openid",
  "email",
  "profile",
];

/** The organizer additionally needs to create the confirmed meeting. */
const WRITE_SCOPES = [...READ_SCOPES, "https://www.googleapis.com/auth/calendar.events"];

/**
 * Google's event ids must be base32hex: lowercase `a`–`v` and `0`–`9`, at least
 * five characters. Deriving one from our idempotency key is what makes a
 * repeated confirmation callback a no-op instead of a second meeting.
 */
export function deterministicGoogleEventId(idempotencyKey: string): string {
  const digest = crypto.createHash("sha256").update(idempotencyKey).digest();
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let out = "g2g";
  for (const byte of digest.subarray(0, 20)) {
    out += alphabet[byte & 0x1f];
  }
  return out;
}

function oauthClient(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function authorizedClient(grant: CalendarGrant) {
  if (!grant.accessToken) {
    throw new CalendarAuthorizationError("Google connection has no access token");
  }
  const client = oauthClient();
  client.setCredentials({
    access_token: grant.accessToken,
    refresh_token: grant.refreshToken ?? undefined,
    expiry_date: grant.tokenExpiresAt ?? undefined,
  });
  return client;
}

/** Maps Google's HTTP failures onto the two categories callers act on. */
function translateError(error: unknown): never {
  const status =
    typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code: unknown }).code)
      : undefined;
  const message = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403 || /invalid_grant/i.test(message)) {
    throw new CalendarAuthorizationError(
      `Google rejected the calendar grant: ${message}`,
      { cause: error }
    );
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    throw new CalendarTransientError(`Google calendar request failed: ${message}`, {
      cause: error,
    });
  }
  throw error instanceof Error ? error : new Error(message);
}

/**
 * Direct Google Calendar access.
 *
 * This is the path that works with the credentials the project already has. It
 * covers Google accounts only — Microsoft, Apple, and Exchange users cannot
 * connect through it, which is precisely the gap a broker closes.
 */
export class GoogleCalendarBroker implements CalendarBroker {
  readonly id = "google" as const;
  readonly displayName = "Google Calendar";
  readonly supportedProviders: CalendarProviderId[] = ["google"];

  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  async buildAuthorizationUrl(
    request: AuthorizationRequest
  ): Promise<AuthorizationRedirect> {
    const client = oauthClient(request.redirectUri);
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: request.needsWriteAccess ? WRITE_SCOPES : READ_SCOPES,
      state: request.state,
      prompt: "consent",
      include_granted_scopes: true,
      code_challenge_method: "S256" as never,
      code_challenge: codeChallenge,
      // Pre-fills the account chooser so a forwarded link is less likely to be
      // completed by the wrong person. The server still verifies the identity.
      login_hint: request.expectedEmail,
    });

    return { url, codeVerifier };
  }

  async completeAuthorization(
    callback: AuthorizationCallback
  ): Promise<CalendarGrant> {
    const client = oauthClient(callback.redirectUri);
    try {
      const { tokens } = await client.getToken({
        code: callback.code,
        codeVerifier: callback.codeVerifier,
      });
      if (!tokens.access_token) {
        throw new CalendarAuthorizationError("Google returned no access token");
      }

      client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      const { data } = await oauth2.userinfo.get();

      return {
        broker: "google",
        provider: "google",
        accountEmail: data.email ?? null,
        brokerProfileId: null,
        brokerAccountId: data.id ?? null,
        sourceCalendarIds: [],
        destinationCalendarId: null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt: tokens.expiry_date ?? null,
      };
    } catch (error) {
      translateError(error);
    }
  }

  async listCalendars(grant: CalendarGrant): Promise<CalendarSummary[]> {
    try {
      const calendar = google.calendar({
        version: "v3",
        auth: authorizedClient(grant),
      });
      const { data } = await calendar.calendarList.list({ maxResults: 250 });
      return (data.items ?? [])
        .filter((item) => item.id)
        .map((item) => ({
          id: item.id!,
          name: item.summaryOverride ?? item.summary ?? item.id!,
          writable: item.accessRole === "owner" || item.accessRole === "writer",
          primary: item.primary === true,
          provider: "google" as const,
        }));
    } catch (error) {
      translateError(error);
    }
  }

  async getFreeBusy(
    grant: CalendarGrant,
    request: FreeBusyRequest
  ): Promise<Interval[]> {
    const calendarIds =
      request.calendarIds ??
      (grant.sourceCalendarIds.length > 0 ? grant.sourceCalendarIds : ["primary"]);

    try {
      const calendar = google.calendar({
        version: "v3",
        auth: authorizedClient(grant),
      });
      const { data } = await calendar.freebusy.query({
        requestBody: {
          timeMin: new Date(request.startMs).toISOString(),
          timeMax: new Date(request.endMs).toISOString(),
          // Every selected calendar, not just `primary`: a person with a work
          // calendar and a personal one is busy on both.
          items: calendarIds.map((id) => ({ id })),
        },
      });

      const intervals: Interval[] = [];
      for (const id of calendarIds) {
        const entry = data.calendars?.[id];
        if (entry?.errors?.length) {
          // A calendar we can no longer read must not silently read as "free".
          throw new CalendarAuthorizationError(
            `Google denied free/busy for calendar ${id}: ${entry.errors
              .map((e) => e.reason)
              .join(", ")}`
          );
        }
        for (const busy of entry?.busy ?? []) {
          if (!busy.start || !busy.end) continue;
          intervals.push([
            new Date(busy.start).getTime(),
            new Date(busy.end).getTime(),
          ]);
        }
      }
      return mergeBusy(intervals);
    } catch (error) {
      translateError(error);
    }
  }

  async createEvent(
    grant: CalendarGrant,
    request: CalendarEventRequest
  ): Promise<CalendarEventResult> {
    const calendar = google.calendar({
      version: "v3",
      auth: authorizedClient(grant),
    });
    const eventId = deterministicGoogleEventId(request.idempotencyKey);

    const body = {
      id: eventId,
      summary: request.title,
      description: request.description,
      start: {
        dateTime: new Date(request.startMs).toISOString(),
        timeZone: request.timezone,
      },
      end: {
        dateTime: new Date(request.endMs).toISOString(),
        timeZone: request.timezone,
      },
      attendees: request.attendees.map((attendee) => ({
        email: attendee.email,
        displayName: attendee.displayName,
      })),
      guestsCanModify: false,
    };

    try {
      const { data } = await calendar.events.insert({
        calendarId: request.calendarId,
        sendUpdates: "all",
        requestBody: body,
      });
      return {
        externalEventId: data.id ?? eventId,
        htmlLink: data.htmlLink ?? undefined,
        deduplicated: false,
      };
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "code" in error
          ? Number((error as { code: unknown }).code)
          : undefined;

      // 409 means this exact event id already exists — the retry did its job.
      if (status === 409) {
        try {
          const { data } = await calendar.events.get({
            calendarId: request.calendarId,
            eventId,
          });
          return {
            externalEventId: data.id ?? eventId,
            htmlLink: data.htmlLink ?? undefined,
            deduplicated: true,
          };
        } catch {
          return { externalEventId: eventId, deduplicated: true };
        }
      }
      translateError(error);
    }
  }

  async revoke(grant: CalendarGrant): Promise<void> {
    const token = grant.refreshToken ?? grant.accessToken;
    if (!token) return;
    try {
      await oauthClient().revokeToken(token);
    } catch {
      // Revocation is best-effort: the grant is being dropped locally either
      // way, and an already-revoked token reports as an error.
    }
  }
}
