import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db";
import {
  calendarConnections,
  events,
  oauthStates,
  participants,
  type Participant,
} from "./db/schema";
import {
  connectionToGrant,
  getActiveBroker,
  getBroker,
  grantToConnectionFields,
  type CalendarBroker,
  type CalendarGrant,
  type CalendarProviderId,
} from "./calendar";
import {
  consumeOAuthState,
  createOAuthState,
  emailsMatch,
  type ClientKind,
} from "./oauth-state";
import { advanceEvent } from "./scheduler";
import { sendInvitations } from "./invitations";
import { baseUrl } from "./email";

/**
 * Canonical callback.
 *
 * `/api/auth/google/callback` remains registered with Google and delegates
 * here, so an existing OAuth client keeps working while new brokers register
 * this path.
 */
export function callbackUrl(): string {
  return `${baseUrl()}/api/calendar/callback`;
}

/** The legacy path, still honoured for the already-registered Google client. */
export function legacyGoogleCallbackUrl(): string {
  return `${baseUrl()}/api/auth/google/callback`;
}

/**
 * Restricts post-authorization redirects to destinations we own.
 *
 * Without this, `returnTo` is an open redirect: an attacker could send someone
 * through a real authorization and land them on a page of their choosing.
 */
export function safeReturnTo(candidate: string | null, fallback: string): string {
  if (!candidate) return fallback;

  // Relative paths are always ours.
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;

  try {
    const url = new URL(candidate);
    if (url.origin === new URL(baseUrl()).origin) return url.toString();
    // The iOS app's private scheme, for the ASWebAuthenticationSession flow.
    if (url.protocol === "get2gethr:") return url.toString();
  } catch {
    // fall through
  }
  return fallback;
}

export interface StartConnectionInput {
  participant: Participant;
  provider?: CalendarProviderId;
  clientKind?: ClientKind;
  returnTo?: string | null;
}

export interface StartedConnection {
  authorizationUrl: string;
  state: string;
  broker: CalendarBroker;
}

/**
 * Begins a calendar connection for one participant.
 *
 * The organizer needs write access because the confirmed meeting is created on
 * their calendar; everyone else is only ever asked for free/busy.
 */
export async function startConnection(
  input: StartConnectionInput
): Promise<StartedConnection> {
  const broker = getActiveBroker();
  const needsWriteAccess = input.participant.role === "organizer";
  const fallbackReturn = `/invite/${input.participant.inviteToken}`;

  // The state row is created first so the authorization URL can carry a nonce
  // that already exists and is already single-use.
  const { state } = await createOAuthState({
    participantId: input.participant.id,
    eventId: input.participant.eventId,
    provider: input.provider ?? "auto",
    returnTo: safeReturnTo(input.returnTo ?? null, fallbackReturn),
    clientKind: input.clientKind ?? "web",
  });

  const authorized = await broker.buildAuthorizationUrl({
    state,
    redirectUri: callbackUrl(),
    needsWriteAccess,
    preferredProvider: input.provider,
    expectedEmail: input.participant.email,
  });

  // PKCE verifiers are minted by the broker, so the row is completed once the
  // URL that will be used actually exists.
  if (authorized.codeVerifier) {
    await db
      .update(oauthStates)
      .set({ codeVerifier: authorized.codeVerifier })
      .where(eq(oauthStates.id, state));
  }

  return { authorizationUrl: authorized.url, state, broker };
}

export type CallbackOutcome =
  | { ok: true; redirectTo: string }
  | {
      ok: false;
      redirectTo: string;
      reason:
        | "invalid_state"
        | "expired_state"
        | "replayed_state"
        | "account_mismatch"
        | "denied"
        | "provider_error";
    };

export interface HandleCallbackInput {
  code: string | null;
  state: string | null;
  error: string | null;
  redirectUri: string;
}

/**
 * Completes a calendar connection.
 *
 * Everything that made the previous implementation unsafe is addressed here:
 * the state is a single-use nonce rather than the invite token, it is consumed
 * atomically so a replay fails, and the connected account must be the person we
 * invited.
 */
export async function handleCallback(
  input: HandleCallbackInput
): Promise<CallbackOutcome> {
  const home = "/";

  if (!input.state) {
    return { ok: false, redirectTo: `${home}?error=invalid_state`, reason: "invalid_state" };
  }

  const consumed = await consumeOAuthState(input.state);
  if (!consumed.ok) {
    const reason =
      consumed.reason === "expired"
        ? ("expired_state" as const)
        : consumed.reason === "already_used"
          ? ("replayed_state" as const)
          : ("invalid_state" as const);
    return { ok: false, redirectTo: `${home}?error=${reason}`, reason };
  }

  const state = consumed.state;
  const participant = await db.query.participants.findFirst({
    where: eq(participants.id, state.participantId),
  });
  if (!participant) {
    return { ok: false, redirectTo: `${home}?error=invalid_state`, reason: "invalid_state" };
  }

  const returnTo = state.returnTo;

  if (input.error || !input.code) {
    // The person cancelled, or the provider refused. Say so plainly instead of
    // leaving them on a page that claims nothing happened.
    return {
      ok: false,
      redirectTo: appendParam(returnTo, "error", "denied"),
      reason: "denied",
    };
  }

  const broker = getActiveBroker();
  let grant: CalendarGrant;
  try {
    grant = await broker.completeAuthorization({
      code: input.code,
      redirectUri: input.redirectUri,
      codeVerifier: state.codeVerifier ?? undefined,
    });
  } catch (error) {
    console.error("Calendar authorization failed:", error);
    return {
      ok: false,
      redirectTo: appendParam(returnTo, "error", "provider_error"),
      reason: "provider_error",
    };
  }

  // A forwarded invite must not attach the forwarder's calendar to the invited
  // person's record.
  const policy = process.env.CALENDAR_IDENTITY_POLICY ?? "strict";
  if (
    policy !== "relaxed" &&
    grant.accountEmail &&
    !emailsMatch(participant.email, grant.accountEmail)
  ) {
    await broker.revoke(grant).catch(() => {});
    return {
      ok: false,
      redirectTo: appendParam(returnTo, "error", "account_mismatch"),
      reason: "account_mismatch",
    };
  }

  // Default to every readable calendar, not just `primary`: someone with a
  // work calendar and a personal one is busy on both.
  let sourceCalendarIds: string[] = [];
  let destinationCalendarId: string | null = null;
  try {
    const calendars = await broker.listCalendars(grant);
    sourceCalendarIds = calendars.map((calendar) => calendar.id);
    if (participant.role === "organizer") {
      destinationCalendarId =
        calendars.find((calendar) => calendar.primary && calendar.writable)?.id ??
        calendars.find((calendar) => calendar.writable)?.id ??
        null;
    }
  } catch (error) {
    console.error("Could not list calendars after authorization:", error);
  }

  const enriched: CalendarGrant = {
    ...grant,
    sourceCalendarIds,
    destinationCalendarId,
  };

  await upsertConnection(participant, enriched);

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(participants)
    .set({
      status: "joined",
      name: participant.name ?? deriveName(grant.accountEmail ?? participant.email),
      joinedAt: participant.joinedAt ?? now,
    })
    .where(eq(participants.id, participant.id));

  // The organizer connecting is what releases the invitations — which is how
  // the organizer's own availability ends up in the calculation at all.
  if (participant.role === "organizer") {
    const promoted = await db
      .update(events)
      .set({ status: "gathering", updatedAt: now })
      .where(eq(events.id, participant.eventId))
      .returning();
    if (promoted.length === 1 && promoted[0].status === "gathering") {
      await sendInvitations(participant.eventId).catch((error) => {
        console.error("Sending invitations failed:", error);
      });
    }
  }

  await advanceEvent(participant.eventId).catch((error) => {
    console.error("advanceEvent after connection failed:", error);
  });

  return { ok: true, redirectTo: appendParam(returnTo, "connected", "1") };
}

async function upsertConnection(
  participant: Participant,
  grant: CalendarGrant
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const fields = grantToConnectionFields(grant);

  const existing = await db.query.calendarConnections.findFirst({
    where: eq(calendarConnections.participantId, participant.id),
  });

  if (existing) {
    await db
      .update(calendarConnections)
      .set({ ...fields, status: "connected", lastError: null, updatedAt: now })
      .where(eq(calendarConnections.id, existing.id));
    return;
  }

  const id = uuidv4();
  await db.insert(calendarConnections).values({
    id,
    participantId: participant.id,
    ...fields,
    status: "connected",
    createdAt: now,
    updatedAt: now,
  });
  await db
    .update(participants)
    .set({ connectionId: id })
    .where(eq(participants.id, participant.id));
}

/** Disconnects a participant's calendar and revokes the grant upstream. */
export async function disconnect(participantId: string): Promise<boolean> {
  const connection = await db.query.calendarConnections.findFirst({
    where: eq(calendarConnections.participantId, participantId),
  });
  if (!connection) return false;

  try {
    await getBroker(connection.broker as never).revoke(connectionToGrant(connection));
  } catch {
    // The local record is removed regardless.
  }

  await db
    .delete(calendarConnections)
    .where(eq(calendarConnections.id, connection.id));
  await db
    .update(participants)
    .set({ connectionId: null, status: "pending", joinedAt: null })
    .where(eq(participants.id, participantId));
  return true;
}

function deriveName(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function appendParam(target: string, key: string, value: string): string {
  const separator = target.includes("?") ? "&" : "?";
  return `${target}${separator}${key}=${encodeURIComponent(value)}`;
}
