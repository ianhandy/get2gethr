import crypto from "node:crypto";
import type { Interval } from "../availability";
import { mergeBusy } from "../availability";
import { createPkcePair } from "../oauth-state";
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

const IDENTITY_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const COMMON_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read"];
const READ_SCOPES = [...COMMON_SCOPES, "Calendars.ReadBasic"];
const WRITE_SCOPES = [...COMMON_SCOPES, "Calendars.ReadWrite"];

interface MicrosoftTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface MicrosoftProfile {
  id?: string;
  mail?: string | null;
  userPrincipalName?: string | null;
}

interface MicrosoftCalendar {
  id?: string;
  name?: string;
  canEdit?: boolean;
  isDefaultCalendar?: boolean;
}

interface MicrosoftDateTime {
  dateTime?: string;
  timeZone?: string;
}

interface MicrosoftEvent {
  id?: string;
  webLink?: string;
  start?: MicrosoftDateTime;
  end?: MicrosoftDateTime;
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  isCancelled?: boolean;
}

interface GraphCollection<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Microsoft Calendar is not configured: set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET"
    );
  }
  return { clientId, clientSecret };
}

function scopes(needsWriteAccess: boolean): string[] {
  return needsWriteAccess ? WRITE_SCOPES : READ_SCOPES;
}

function eventTransactionId(idempotencyKey: string): string {
  const digest = crypto.createHash("sha256").update(idempotencyKey).digest("base64url");
  return `get2gethr-${digest}`;
}

function graphPath(pathOrUrl: string): string {
  if (!pathOrUrl.startsWith("http")) return `${GRAPH_BASE}${pathOrUrl}`;
  const url = new URL(pathOrUrl);
  if (url.origin !== "https://graph.microsoft.com") {
    throw new Error("Microsoft Graph returned an unexpected pagination URL");
  }
  return url.toString();
}

function graphTimeMs(value: MicrosoftDateTime | undefined): number | null {
  if (!value?.dateTime) return null;
  let dateTime = value.dateTime;
  if (!/[zZ]|[+-]\d\d:\d\d$/.test(dateTime)) {
    // Requests below ask Graph for UTC. Graph normally returns a zone-less
    // dateTime plus `timeZone: UTC`, so make that interpretation explicit.
    dateTime = `${dateTime.replace(/(\.\d{3})\d+$/, "$1")}Z`;
  }
  const parsed = Date.parse(dateTime);
  return Number.isFinite(parsed) ? parsed : null;
}

function graphWallClockDateTime(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
}

/** Direct Microsoft 365 and Outlook.com calendar access through Graph v1.0. */
export class MicrosoftCalendarBroker implements CalendarBroker {
  readonly id = "microsoft" as const;
  readonly displayName = "Microsoft Calendar";
  readonly supportedProviders: CalendarProviderId[] = ["microsoft"];

  isConfigured(): boolean {
    return Boolean(
      process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
    );
  }

  async buildAuthorizationUrl(
    request: AuthorizationRequest
  ): Promise<AuthorizationRedirect> {
    const { clientId } = credentials();
    const { verifier, challenge } = createPkcePair();
    const url = new URL(`${IDENTITY_BASE}/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", scopes(request.needsWriteAccess).join(" "));
    url.searchParams.set("state", request.state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    if (request.expectedEmail) url.searchParams.set("login_hint", request.expectedEmail);
    return { url: url.toString(), codeVerifier: verifier };
  }

  async completeAuthorization(
    callback: AuthorizationCallback
  ): Promise<CalendarGrant> {
    const { clientId, clientSecret } = credentials();
    if (!callback.codeVerifier) {
      throw new CalendarAuthorizationError("Microsoft authorization is missing PKCE state");
    }

    const token = await this.tokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: callback.code,
      redirect_uri: callback.redirectUri,
      code_verifier: callback.codeVerifier,
    });
    if (!token.access_token) {
      throw new CalendarAuthorizationError("Microsoft returned no access token");
    }

    const profile = await this.graphRequest<MicrosoftProfile>(token.access_token, "/me?$select=id,mail,userPrincipalName");
    return {
      broker: "microsoft",
      provider: "microsoft",
      accountEmail: profile.mail ?? profile.userPrincipalName ?? null,
      brokerProfileId: null,
      brokerAccountId: profile.id ?? null,
      sourceCalendarIds: [],
      destinationCalendarId: null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      tokenExpiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
    };
  }

  async refreshGrant(grant: CalendarGrant): Promise<CalendarGrant> {
    if (
      grant.accessToken &&
      (!grant.tokenExpiresAt || grant.tokenExpiresAt - Date.now() > 60_000)
    ) {
      return grant;
    }
    if (!grant.refreshToken) {
      throw new CalendarAuthorizationError(
        "Microsoft Calendar access expired and no refresh token is available"
      );
    }

    const { clientId, clientSecret } = credentials();
    const token = await this.tokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: grant.refreshToken,
    });
    if (!token.access_token) {
      throw new CalendarAuthorizationError("Microsoft returned no refreshed access token");
    }
    return {
      ...grant,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? grant.refreshToken,
      tokenExpiresAt: token.expires_in
        ? Date.now() + token.expires_in * 1000
        : grant.tokenExpiresAt,
    };
  }

  async listCalendars(grant: CalendarGrant): Promise<CalendarSummary[]> {
    const fresh = await this.refreshGrant(grant);
    const calendars = await this.graphCollection<MicrosoftCalendar>(
      fresh,
      "/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100"
    );
    return calendars
      .filter((calendar): calendar is MicrosoftCalendar & { id: string } =>
        Boolean(calendar.id)
      )
      .map((calendar) => ({
        id: calendar.id,
        name: calendar.name ?? "Calendar",
        writable: calendar.canEdit === true,
        primary: calendar.isDefaultCalendar === true,
        provider: "microsoft" as const,
      }));
  }

  async getFreeBusy(
    grant: CalendarGrant,
    request: FreeBusyRequest
  ): Promise<Interval[]> {
    const fresh = await this.refreshGrant(grant);
    const calendarIds =
      request.calendarIds ??
      (grant.sourceCalendarIds.length > 0 ? grant.sourceCalendarIds : ["primary"]);

    const batches = await Promise.all(
      calendarIds.map(async (calendarId) => {
        const params = new URLSearchParams({
          startDateTime: new Date(request.startMs).toISOString(),
          endDateTime: new Date(request.endMs).toISOString(),
          "$select": "start,end,showAs,isCancelled",
          "$top": "1000",
        });
        const root =
          calendarId === "primary"
            ? "/me/calendar/calendarView"
            : `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`;
        return this.graphCollection<MicrosoftEvent>(fresh, `${root}?${params}`);
      })
    );

    const intervals: Interval[] = [];
    for (const events of batches) {
      for (const event of events) {
        if (event.isCancelled || event.showAs === "free") continue;
        const start = graphTimeMs(event.start);
        const end = graphTimeMs(event.end);
        if (start !== null && end !== null && end > start) intervals.push([start, end]);
      }
    }
    return mergeBusy(intervals);
  }

  async createEvent(
    grant: CalendarGrant,
    request: CalendarEventRequest
  ): Promise<CalendarEventResult> {
    const fresh = await this.refreshGrant(grant);
    const root =
      request.calendarId === "primary"
        ? "/me/calendar/events"
        : `/me/calendars/${encodeURIComponent(request.calendarId)}/events`;
    const event = await this.graphRequestWithGrant<MicrosoftEvent>(fresh, root, {
      method: "POST",
      body: JSON.stringify({
        subject: request.title,
        body: {
          contentType: "text",
          content: request.description ?? "",
        },
        start: {
          dateTime: graphWallClockDateTime(request.startMs, request.timezone),
          timeZone: request.timezone,
        },
        end: {
          dateTime: graphWallClockDateTime(request.endMs, request.timezone),
          timeZone: request.timezone,
        },
        attendees: request.attendees.map((attendee) => ({
          emailAddress: {
            address: attendee.email,
            name: attendee.displayName ?? attendee.email,
          },
          type: "required",
        })),
        allowNewTimeProposals: false,
        transactionId: eventTransactionId(request.idempotencyKey),
      }),
    });
    if (!event.id) throw new Error("Microsoft created an event without an id");
    return {
      externalEventId: event.id,
      htmlLink: event.webLink,
      deduplicated: false,
    };
  }

  async revoke(): Promise<void> {
    // Microsoft exposes no narrow OAuth token-revocation endpoint. Disconnect
    // deletes the encrypted local grant; the user can also revoke app consent
    // from their Microsoft account without affecting other sign-in sessions.
  }

  private async tokenRequest(
    values: Record<string, string>
  ): Promise<MicrosoftTokenResponse> {
    let response: Response;
    try {
      response = await fetch(`${IDENTITY_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(values),
      });
    } catch (error) {
      throw new CalendarTransientError("Could not reach Microsoft identity", {
        cause: error,
      });
    }
    const data = (await response.json().catch(() => ({}))) as MicrosoftTokenResponse;
    if (!response.ok) {
      const message = data.error_description ?? data.error ?? `HTTP ${response.status}`;
      if (response.status === 429 || response.status >= 500) {
        throw new CalendarTransientError(`Microsoft token request failed: ${message}`);
      }
      throw new CalendarAuthorizationError(`Microsoft rejected the grant: ${message}`);
    }
    return data;
  }

  private async graphRequest<T>(
    accessToken: string,
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("Prefer", 'outlook.timezone="UTC"');
    if (init.body) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await fetch(graphPath(path), { ...init, headers });
    } catch (error) {
      throw new CalendarTransientError("Could not reach Microsoft Graph", {
        cause: error,
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw new CalendarAuthorizationError(
        `Microsoft Graph rejected the calendar grant (${response.status})`
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new CalendarTransientError(`Microsoft Graph returned ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(
        `Microsoft Graph request failed (${response.status}): ${await response.text()}`
      );
    }
    if (response.status === 204) return {} as T;
    return (await response.json()) as T;
  }

  private async graphRequestWithGrant<T>(
    grant: CalendarGrant,
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    if (!grant.accessToken) {
      throw new CalendarAuthorizationError("Microsoft connection has no access token");
    }
    return this.graphRequest<T>(grant.accessToken, path, init);
  }

  private async graphCollection<T>(
    grant: CalendarGrant,
    initialPath: string
  ): Promise<T[]> {
    const values: T[] = [];
    let path: string | undefined = initialPath;
    let page = 0;
    while (path && page < 50) {
      const data: GraphCollection<T> = await this.graphRequestWithGrant<
        GraphCollection<T>
      >(grant, path);
      values.push(...(data.value ?? []));
      path = data["@odata.nextLink"];
      page += 1;
    }
    if (path) {
      throw new CalendarTransientError("Microsoft calendar result exceeded 50 pages");
    }
    return values;
  }
}

export const __microsoftTest = {
  eventTransactionId,
  graphTimeMs,
};
