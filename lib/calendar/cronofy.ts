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

/**
 * Cronofy broker adapter.
 *
 * Cronofy fronts Google, Microsoft/Office 365, Exchange, and Apple iCloud
 * behind one API, so adding a provider becomes a support question rather than
 * an integration project, and no provider refresh token is ever stored here.
 *
 * Endpoints follow Cronofy's published API. This adapter is inert until a
 * deployment supplies `CRONOFY_CLIENT_ID` and `CRONOFY_CLIENT_SECRET`; with no
 * credentials configured `isConfigured()` is false and the registry falls back
 * to direct Google. It has not been exercised against a live Cronofy
 * account — that sandbox spike needs a Cronofy developer account, which is a
 * commercial decision.
 *
 * @see https://docs.cronofy.com/developers/getting-started/quick-start-guide/api-quick-start-guide/
 */
export class CronofyBroker implements CalendarBroker {
  readonly id = "cronofy" as const;
  readonly displayName = "Cronofy";
  readonly supportedProviders: CalendarProviderId[] = [
    "google",
    "microsoft",
    "apple",
    "exchange",
  ];

  /**
   * Cronofy is deployed per data centre and the hostnames differ. `us` is the
   * default; `de`, `au`, `uk`, `ca`, and `sg` exist for data residency, which
   * is one of the review criteria before signing anything.
   */
  private get apiBase(): string {
    const dc = process.env.CRONOFY_DATA_CENTER?.trim().toLowerCase();
    return !dc || dc === "us"
      ? "https://api.cronofy.com"
      : `https://api-${dc}.cronofy.com`;
  }

  private get appBase(): string {
    const dc = process.env.CRONOFY_DATA_CENTER?.trim().toLowerCase();
    return !dc || dc === "us"
      ? "https://app.cronofy.com"
      : `https://app-${dc}.cronofy.com`;
  }

  isConfigured(): boolean {
    return Boolean(
      process.env.CRONOFY_CLIENT_ID && process.env.CRONOFY_CLIENT_SECRET
    );
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const clientId = process.env.CRONOFY_CLIENT_ID;
    const clientSecret = process.env.CRONOFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        "Cronofy is not configured: set CRONOFY_CLIENT_ID and CRONOFY_CLIENT_SECRET"
      );
    }
    return { clientId, clientSecret };
  }

  private async request<T>(
    path: string,
    init: RequestInit & { accessToken?: string } = {}
  ): Promise<T> {
    const { accessToken, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set("Accept", "application/json");
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    if (rest.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(`${this.apiBase}${path}`, { ...rest, headers });
    } catch (error) {
      throw new CalendarTransientError("Could not reach Cronofy", { cause: error });
    }

    if (response.status === 401 || response.status === 403) {
      throw new CalendarAuthorizationError(
        `Cronofy rejected the grant (${response.status})`
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new CalendarTransientError(`Cronofy returned ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(
        `Cronofy ${path} failed (${response.status}): ${await response.text()}`
      );
    }

    if (response.status === 202 || response.status === 204) return {} as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async buildAuthorizationUrl(
    request: AuthorizationRequest
  ): Promise<AuthorizationRedirect> {
    const { clientId } = this.credentials();

    // `free_busy_write` reads availability and writes only the events we
    // manage — the least privilege that still lets us create the meeting.
    // Attendees who never host get the read-only variant.
    const scope = request.needsWriteAccess ? "free_busy_write" : "free_busy";

    const url = new URL("/oauth/authorize", this.appBase);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", request.redirectUri);
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", request.state);
    if (request.preferredProvider && request.preferredProvider !== "other") {
      url.searchParams.set("provider_name", request.preferredProvider);
    }
    if (request.expectedEmail) {
      url.searchParams.set("email", request.expectedEmail);
    }

    return { url: url.toString() };
  }

  async completeAuthorization(
    callback: AuthorizationCallback
  ): Promise<CalendarGrant> {
    const { clientId, clientSecret } = this.credentials();
    const token = await this.request<CronofyTokenResponse>("/oauth/token", {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: callback.code,
        redirect_uri: callback.redirectUri,
      }),
    });

    if (!token.access_token) {
      throw new CalendarAuthorizationError("Cronofy returned no access token");
    }

    const profile = token.linking_profile;
    return {
      broker: "cronofy",
      provider: normalizeProvider(profile?.provider_name),
      accountEmail: profile?.profile_name ?? null,
      brokerProfileId: profile?.profile_id ?? null,
      brokerAccountId: token.account_id ?? token.sub ?? null,
      sourceCalendarIds: [],
      destinationCalendarId: null,
      // The broker holds the provider credentials; what we keep is a token
      // scoped to Cronofy, which is the privacy improvement over direct OAuth.
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      tokenExpiresAt: token.expires_in
        ? Date.now() + token.expires_in * 1000
        : null,
    };
  }

  /** Exchanges a refresh token when the access token is at or near expiry. */
  private async refreshed(grant: CalendarGrant): Promise<CalendarGrant> {
    const expiresAt = grant.tokenExpiresAt;
    if (!grant.refreshToken || (expiresAt && expiresAt - Date.now() > 60_000)) {
      return grant;
    }
    const { clientId, clientSecret } = this.credentials();
    const token = await this.request<CronofyTokenResponse>("/oauth/token", {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: grant.refreshToken,
      }),
    });
    return {
      ...grant,
      accessToken: token.access_token ?? grant.accessToken,
      refreshToken: token.refresh_token ?? grant.refreshToken,
      tokenExpiresAt: token.expires_in
        ? Date.now() + token.expires_in * 1000
        : grant.tokenExpiresAt,
    };
  }

  private async accessToken(grant: CalendarGrant): Promise<string> {
    const fresh = await this.refreshed(grant);
    if (!fresh.accessToken) {
      throw new CalendarAuthorizationError("Cronofy connection has no access token");
    }
    return fresh.accessToken;
  }

  async listCalendars(grant: CalendarGrant): Promise<CalendarSummary[]> {
    const data = await this.request<{ calendars?: CronofyCalendar[] }>(
      "/v1/calendars",
      { accessToken: await this.accessToken(grant) }
    );
    return (data.calendars ?? [])
      .filter((calendar) => !calendar.calendar_deleted)
      .map((calendar) => ({
        id: calendar.calendar_id,
        name: calendar.profile_name
          ? `${calendar.calendar_name} (${calendar.profile_name})`
          : calendar.calendar_name,
        writable: calendar.calendar_readonly !== true,
        primary: calendar.calendar_primary === true,
        provider: normalizeProvider(calendar.provider_name),
      }));
  }

  async getFreeBusy(
    grant: CalendarGrant,
    request: FreeBusyRequest
  ): Promise<Interval[]> {
    const accessToken = await this.accessToken(grant);
    const calendarIds = request.calendarIds ?? grant.sourceCalendarIds;

    const params = new URLSearchParams({
      from: new Date(request.startMs).toISOString(),
      to: new Date(request.endMs).toISOString(),
      tzid: "Etc/UTC",
      include_managed: "true",
    });
    for (const id of calendarIds) params.append("calendar_ids[]", id);

    const intervals: Interval[] = [];
    let path: string | null = `/v1/free_busy?${params.toString()}`;
    let page = 0;

    // The endpoint pages; stopping early would silently read as "free".
    while (path && page < 50) {
      const data: CronofyFreeBusyResponse = await this.request<CronofyFreeBusyResponse>(
        path,
        { accessToken }
      );
      for (const entry of data.free_busy ?? []) {
        if (entry.free_busy_status === "free") continue;
        const start = new Date(entry.start).getTime();
        const end = new Date(entry.end).getTime();
        if (Number.isFinite(start) && Number.isFinite(end)) {
          intervals.push([start, end]);
        }
      }
      const next = data.pages?.next_page;
      path = next ? new URL(next).pathname + new URL(next).search : null;
      page += 1;
    }

    return mergeBusy(intervals);
  }

  async createEvent(
    grant: CalendarGrant,
    request: CalendarEventRequest
  ): Promise<CalendarEventResult> {
    const accessToken = await this.accessToken(grant);

    // Cronofy upserts on (calendar_id, event_id), so replaying this request
    // updates the one meeting rather than creating another.
    await this.request(
      `/v1/calendars/${encodeURIComponent(request.calendarId)}/events`,
      {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          event_id: request.idempotencyKey,
          summary: request.title,
          description: request.description ?? "",
          start: { time: new Date(request.startMs).toISOString(), tzid: request.timezone },
          end: { time: new Date(request.endMs).toISOString(), tzid: request.timezone },
          tzid: request.timezone,
          attendees: {
            invite: request.attendees.map((attendee) => ({
              email: attendee.email,
              display_name: attendee.displayName ?? attendee.email,
            })),
          },
        }),
      }
    );

    return { externalEventId: request.idempotencyKey, deduplicated: false };
  }

  async revoke(grant: CalendarGrant): Promise<void> {
    const token = grant.refreshToken ?? grant.accessToken;
    if (!token) return;
    const { clientId, clientSecret } = this.credentials();
    try {
      await this.request("/oauth/token/revoke", {
        method: "POST",
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          token,
        }),
      });
    } catch {
      // Best effort; the local grant is dropped regardless.
    }
  }
}

function normalizeProvider(name: string | undefined): CalendarProviderId {
  switch (name) {
    case "google":
      return "google";
    case "office365":
    case "live_connect":
    case "microsoft":
      return "microsoft";
    case "apple":
    case "icloud":
      return "apple";
    case "exchange":
      return "exchange";
    default:
      return "other";
  }
}

interface CronofyTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  account_id?: string;
  sub?: string;
  linking_profile?: {
    provider_name?: string;
    profile_id?: string;
    profile_name?: string;
  };
}

interface CronofyCalendar {
  provider_name?: string;
  profile_id?: string;
  profile_name?: string;
  calendar_id: string;
  calendar_name: string;
  calendar_readonly?: boolean;
  calendar_deleted?: boolean;
  calendar_primary?: boolean;
}

interface CronofyFreeBusyResponse {
  pages?: { current: number; total: number; next_page?: string };
  free_busy?: Array<{
    calendar_id: string;
    start: string;
    end: string;
    free_busy_status: "busy" | "tentative" | "free" | "unknown";
  }>;
}
