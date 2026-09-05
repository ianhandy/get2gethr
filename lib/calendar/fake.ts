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

interface FakeAccount {
  email: string;
  provider: CalendarProviderId;
  calendars: CalendarSummary[];
  busy: Interval[];
}

/**
 * In-memory broker used by the test suite.
 *
 * It exists so the scheduler's hard paths — duplicate confirmations, provider
 * outages, revoked grants, availability that changes between proposal and
 * write — are exercised deterministically instead of only against a live
 * provider. It records every created event so tests can assert that a
 * confirmed meeting was written exactly once.
 */
export class FakeCalendarBroker implements CalendarBroker {
  readonly id = "fake" as const;
  readonly displayName = "Test Calendar";
  readonly supportedProviders: CalendarProviderId[] = [
    "google",
    "microsoft",
    "apple",
    "exchange",
  ];

  /** Authorization codes handed out by tests, keyed to an account. */
  readonly accounts = new Map<string, FakeAccount>();
  /** Every event write, keyed by `${calendarId}:${idempotencyKey}`. */
  readonly createdEvents = new Map<string, CalendarEventRequest>();
  readonly createEventCalls: CalendarEventRequest[] = [];
  readonly revoked: string[] = [];

  /** Set to make the next N calls fail as transient provider errors. */
  failNextCalls = 0;
  /** Set to make every grant read as expired. */
  authorizationRevoked = false;

  isConfigured(): boolean {
    return true;
  }

  registerAccount(code: string, account: Partial<FakeAccount> & { email: string }): void {
    this.accounts.set(code, {
      provider: "google",
      calendars: [
        {
          id: `${account.email}:primary`,
          name: "Primary",
          writable: true,
          primary: true,
          provider: account.provider ?? "google",
        },
      ],
      busy: [],
      ...account,
    });
  }

  setBusy(email: string, busy: Interval[]): void {
    for (const account of this.accounts.values()) {
      if (account.email === email) account.busy = busy;
    }
  }

  private guard(): void {
    if (this.authorizationRevoked) {
      throw new CalendarAuthorizationError("Test grant was revoked");
    }
    if (this.failNextCalls > 0) {
      this.failNextCalls -= 1;
      throw new CalendarTransientError("Test provider outage");
    }
  }

  private accountFor(grant: CalendarGrant): FakeAccount {
    for (const account of this.accounts.values()) {
      if (account.email === grant.accountEmail) return account;
    }
    throw new CalendarAuthorizationError(`No test account for ${grant.accountEmail}`);
  }

  async buildAuthorizationUrl(
    request: AuthorizationRequest
  ): Promise<AuthorizationRedirect> {
    return {
      url: `https://calendar.test/authorize?state=${encodeURIComponent(request.state)}`,
      codeVerifier: "test-verifier",
    };
  }

  async completeAuthorization(
    callback: AuthorizationCallback
  ): Promise<CalendarGrant> {
    this.guard();
    const account = this.accounts.get(callback.code);
    if (!account) {
      throw new CalendarAuthorizationError(`Unknown test code ${callback.code}`);
    }
    return {
      broker: "fake",
      provider: account.provider,
      accountEmail: account.email,
      brokerProfileId: `profile-${account.email}`,
      brokerAccountId: `account-${account.email}`,
      sourceCalendarIds: [],
      destinationCalendarId: null,
      accessToken: `token-${account.email}`,
      refreshToken: `refresh-${account.email}`,
      tokenExpiresAt: null,
    };
  }

  async listCalendars(grant: CalendarGrant): Promise<CalendarSummary[]> {
    this.guard();
    return this.accountFor(grant).calendars;
  }

  async getFreeBusy(
    grant: CalendarGrant,
    request: FreeBusyRequest
  ): Promise<Interval[]> {
    this.guard();
    const account = this.accountFor(grant);
    return mergeBusy(
      account.busy.filter(
        ([start, end]) => end > request.startMs && start < request.endMs
      )
    );
  }

  async createEvent(
    grant: CalendarGrant,
    request: CalendarEventRequest
  ): Promise<CalendarEventResult> {
    this.guard();
    this.createEventCalls.push(request);
    const key = `${request.calendarId}:${request.idempotencyKey}`;
    const existing = this.createdEvents.has(key);
    if (!existing) this.createdEvents.set(key, request);
    return {
      externalEventId: `evt-${request.idempotencyKey}`,
      htmlLink: `https://calendar.test/events/${request.idempotencyKey}`,
      deduplicated: existing,
    };
  }

  async revoke(grant: CalendarGrant): Promise<void> {
    if (grant.accountEmail) this.revoked.push(grant.accountEmail);
  }
}
