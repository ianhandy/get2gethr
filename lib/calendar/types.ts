import type { Interval } from "../availability";

/**
 * The calendar system a person actually uses. This is what the UI names when it
 * has to ("Apple needs an app-specific password"), and nothing else in the app
 * branches on it.
 */
export type CalendarProviderId =
  | "google"
  | "microsoft"
  | "apple"
  | "exchange"
  | "other";

/**
 * How get2gethr reaches a calendar.
 *
 * `google` talks to Google directly and is the only path that works without a
 * vendor contract. `cronofy` is the broker the audit recommends: one
 * integration covering Google, Microsoft, Apple, and Exchange. Both satisfy the
 * same interface, so choosing between them is configuration, not a rewrite.
 */
export type BrokerId = "google" | "cronofy" | "fake";

/** A durable handle to someone's calendar access, as stored in the database. */
export interface CalendarGrant {
  broker: BrokerId;
  provider: CalendarProviderId;
  accountEmail: string | null;
  /** Broker-side identifiers. Null for direct providers. */
  brokerProfileId: string | null;
  brokerAccountId: string | null;
  /** Calendars contributing busy time. Empty means "the broker's default set". */
  sourceCalendarIds: string[];
  /** Where confirmed meetings are written. Organizer connections only. */
  destinationCalendarId: string | null;
  /**
   * Direct-provider credentials. A broker keeps its own tokens and leaves these
   * null, which is the main privacy argument for adopting one.
   */
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
}

export interface CalendarSummary {
  id: string;
  name: string;
  /** Whether this calendar can receive a new event. */
  writable: boolean;
  /** The provider's own idea of the user's default calendar. */
  primary: boolean;
  provider: CalendarProviderId;
}

export interface AuthorizationRequest {
  /** Opaque, short-lived, single-use. Never an invite token. */
  state: string;
  /** Absolute HTTPS callback registered with the provider or broker. */
  redirectUri: string;
  /**
   * Whether this connection will need to write a meeting. Attendees only need
   * to share free/busy; asking for less is the point of separating the two.
   */
  needsWriteAccess: boolean;
  /** Nudges the hosted UI toward one provider when the user already picked. */
  preferredProvider?: CalendarProviderId;
  /** The address we expect the connected account to match. */
  expectedEmail?: string;
}

export interface AuthorizationRedirect {
  url: string;
  /** PKCE verifier to persist alongside the state, when the broker supports it. */
  codeVerifier?: string;
}

export interface AuthorizationCallback {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface FreeBusyRequest {
  startMs: number;
  endMs: number;
  /** Overrides the grant's stored calendars when supplied. */
  calendarIds?: string[];
}

export interface CalendarEventAttendee {
  email: string;
  displayName?: string;
}

export interface CalendarEventRequest {
  /**
   * Stable across retries. The broker turns this into a provider-side unique
   * id so that "create" run twice yields one meeting, not two.
   */
  idempotencyKey: string;
  calendarId: string;
  title: string;
  description?: string;
  startMs: number;
  endMs: number;
  timezone: string;
  organizer: CalendarEventAttendee;
  attendees: CalendarEventAttendee[];
}

export interface CalendarEventResult {
  externalEventId: string;
  htmlLink?: string;
  /** True when the event already existed and this call was a no-op. */
  deduplicated: boolean;
}

/**
 * The whole calendar surface, in one provider-neutral shape.
 *
 * Everything above this interface — the scheduler, the API routes, both
 * clients — is written against it alone. Swapping Google for Cronofy, or
 * Cronofy for Nylas, is a new file in this directory and an env var.
 */
export interface CalendarBroker {
  readonly id: BrokerId;
  readonly displayName: string;
  readonly supportedProviders: CalendarProviderId[];

  /** False when the deployment has no credentials for this broker. */
  isConfigured(): boolean;

  buildAuthorizationUrl(
    request: AuthorizationRequest
  ): Promise<AuthorizationRedirect>;

  /** Turns a provider callback into a storable grant. */
  completeAuthorization(callback: AuthorizationCallback): Promise<CalendarGrant>;

  listCalendars(grant: CalendarGrant): Promise<CalendarSummary[]>;

  /** Busy intervals, merged across every source calendar on the grant. */
  getFreeBusy(grant: CalendarGrant, request: FreeBusyRequest): Promise<Interval[]>;

  /** Idempotent: calling twice with the same key yields one event. */
  createEvent(
    grant: CalendarGrant,
    request: CalendarEventRequest
  ): Promise<CalendarEventResult>;

  revoke(grant: CalendarGrant): Promise<void>;
}

/** Raised when a grant no longer works and the person must reconnect. */
export class CalendarAuthorizationError extends Error {
  readonly needsRelink = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CalendarAuthorizationError";
  }
}

/** Raised for transient provider failures that a retry may fix. */
export class CalendarTransientError extends Error {
  readonly retryable = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CalendarTransientError";
  }
}

/** Raised when the connected account is not the person we invited. */
export class CalendarIdentityMismatchError extends Error {
  constructor(
    readonly expectedEmail: string,
    readonly actualEmail: string
  ) {
    super(
      `Connected calendar belongs to ${actualEmail}, but this invitation is for ${expectedEmail}`
    );
    this.name = "CalendarIdentityMismatchError";
  }
}
