import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { safeEqual } from "./crypto";
import {
  events,
  participants,
  type CalendarConnection,
  type Event,
  type Participant,
  type ProposedSlot,
} from "./db/schema";

/**
 * Who is asking.
 *
 * Holding an event UUID used to be enough to read organizer and attendee
 * details. It no longer is: the organizer proves it with a separate secret,
 * and an attendee only ever proves it with their own invite token.
 */
export type Audience =
  | { kind: "organizer"; event: Event; participant: Participant | null }
  | { kind: "attendee"; event: Event; participant: Participant };

export class AuthorizationError extends Error {
  constructor(
    readonly status: 401 | 403 | 404,
    message: string
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Pulls the organizer capability from a header or query string. */
export function readOrganizerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  const fromHeader = request.headers.get("x-organizer-token");
  if (fromHeader) return fromHeader.trim() || null;
  try {
    return new URL(request.url).searchParams.get("organizerToken");
  } catch {
    return null;
  }
}

/**
 * Authorizes an organizer for one specific event.
 *
 * A missing event and a wrong token both report 404, so the endpoint cannot be
 * used to probe which event UUIDs exist.
 */
export async function authorizeOrganizer(
  eventId: string,
  token: string | null
): Promise<Audience> {
  if (!token) {
    throw new AuthorizationError(401, "Organizer credential required");
  }

  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  // Compare regardless of whether the event exists, so timing does not leak.
  const expected = event?.organizerToken ?? "";
  if (!event || !safeEqual(token, expected)) {
    throw new AuthorizationError(404, "Event not found");
  }

  const organizerRow = await db.query.participants.findFirst({
    where: and(
      eq(participants.eventId, eventId),
      eq(participants.role, "organizer")
    ),
  });

  return { kind: "organizer", event, participant: organizerRow ?? null };
}

/**
 * Authorizes an attendee from their invite token.
 *
 * The token identifies exactly one participant of exactly one event, so a token
 * from event A can never read event B.
 */
export async function authorizeInvite(token: string): Promise<Audience> {
  const participant = await db.query.participants.findFirst({
    where: eq(participants.inviteToken, token),
  });
  if (!participant || participant.status === "removed") {
    throw new AuthorizationError(404, "Invitation not found");
  }

  const event = await db.query.events.findFirst({
    where: eq(events.id, participant.eventId),
  });
  if (!event) throw new AuthorizationError(404, "Invitation not found");

  if (participant.role === "organizer") {
    return { kind: "organizer", event, participant };
  }
  return { kind: "attendee", event, participant };
}

/** Guards a mutation that only the organizer may perform. */
export function requireOrganizer(audience: Audience): Event {
  if (audience.kind !== "organizer") {
    throw new AuthorizationError(403, "Only the organizer can do that");
  }
  return audience.event;
}

// --- Audience-scoped serialization ---------------------------------------

export interface ConnectionSummaryView {
  status: CalendarConnection["status"];
  provider: string;
  accountEmail: string | null;
  sourceCalendarCount: number;
  destinationCalendarId: string | null;
  lastSyncedAt: number | null;
}

function connectionView(
  connection: CalendarConnection | null | undefined
): ConnectionSummaryView | null {
  if (!connection) return null;
  return {
    status: connection.status,
    provider: connection.provider,
    accountEmail: connection.accountEmail,
    sourceCalendarCount: safeParseArray(connection.sourceCalendarIds).length,
    destinationCalendarId: connection.destinationCalendarId,
    lastSyncedAt: connection.lastSyncedAt,
  };
}

function safeParseArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function slotView(slot: ProposedSlot | null | undefined) {
  if (!slot) return null;
  return {
    id: slot.id,
    startTime: slot.startTime,
    endTime: slot.endTime,
    rank: slot.rank,
    status: slot.status,
    proposedAt: slot.proposedAt,
  };
}

/** The shared, non-sensitive description of what is being scheduled. */
function publicEventView(event: Event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    organizerName: event.organizerName,
    startDate: event.startDate,
    endDate: event.endDate,
    durationMinutes: event.durationMinutes,
    workingHoursStart: event.workingHoursStart,
    workingHoursEnd: event.workingHoursEnd,
    timezone: event.timezone,
    excludeWeekends: event.excludeWeekends,
    status: event.status,
    calendarWriteStatus: event.calendarWriteStatus,
    responseDeadline: event.responseDeadline,
  };
}

export interface EventViewInput {
  event: Event;
  participants: Participant[];
  connections: Map<string, CalendarConnection>;
  currentSlot: ProposedSlot | null;
  confirmedSlot: ProposedSlot | null;
}

/**
 * Everything the organizer's management surface needs, including addresses —
 * they entered them.
 */
export function organizerEventView(
  input: EventViewInput,
  /** The organizer's own participant row, when the request identified one. */
  viewer?: Participant | null
) {
  const { event, connections } = input;
  const self = viewer ?? input.participants.find((p) => p.role === "organizer") ?? null;

  return {
    event: {
      ...publicEventView(event),
      organizerEmail: event.organizerEmail,
      nonresponderPolicy: event.nonresponderPolicy,
      calendarWriteError: event.calendarWriteError,
      externalEventId: event.externalEventId,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      cancelledAt: event.cancelledAt,
    },
    // The organizer connects a calendar like everyone else, so their own
    // status travels with the view. Without it the invite page cannot tell
    // whether they have connected yet.
    viewer: {
      role: "organizer" as const,
      id: self?.id,
      email: self?.email,
      name: self?.name,
      status: self?.status,
      joinedAt: self?.joinedAt,
      connection: self ? connectionView(connections.get(self.id)) : null,
    },
    participants: input.participants.map((participant) => ({
      id: participant.id,
      email: participant.email,
      name: participant.name,
      role: participant.role,
      status: participant.status,
      joinedAt: participant.joinedAt,
      invitedAt: participant.invitedAt,
      lastRemindedAt: participant.lastRemindedAt,
      connection: connectionView(connections.get(participant.id)),
    })),
    currentSlot: slotView(input.currentSlot),
    confirmedSlot: slotView(input.confirmedSlot),
  };
}

/**
 * What one attendee needs, and no more.
 *
 * Other participants' addresses are deliberately withheld: an invite link can
 * be forwarded, and the guest list is not the forwarding recipient's business
 * until the meeting actually exists on a calendar.
 */
export function attendeeEventView(input: EventViewInput, viewer: Participant) {
  const { event, connections } = input;
  const others = input.participants.filter((p) => p.id !== viewer.id);

  return {
    event: publicEventView(event),
    viewer: {
      role: "attendee" as const,
      id: viewer.id,
      email: viewer.email,
      name: viewer.name,
      status: viewer.status,
      joinedAt: viewer.joinedAt,
      connection: connectionView(connections.get(viewer.id)),
    },
    // Progress, expressed as counts rather than a leaked address book.
    others: {
      total: others.length,
      joined: others.filter((p) => p.status === "joined").length,
      declined: others.filter((p) => p.status === "declined").length,
      pending: others.filter((p) => p.status === "pending").length,
    },
    currentSlot: slotView(input.currentSlot),
    confirmedSlot: slotView(input.confirmedSlot),
  };
}

/** Dispatches to the right view for whoever is asking. */
export function eventViewFor(audience: Audience, input: EventViewInput) {
  if (audience.kind === "organizer") {
    return organizerEventView(input, audience.participant);
  }
  return attendeeEventView(input, audience.participant);
}
