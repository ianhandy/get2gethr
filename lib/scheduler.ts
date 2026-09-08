import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db";
import {
  calendarConnections,
  events,
  participants,
  proposedSlots,
  slotResponses,
  type CalendarConnection,
  type Event,
  type EventStatus,
  type Participant,
  type ProposedSlot,
} from "./db/schema";
import { computeCandidateSlots, isSlotStillFree, type Interval } from "./availability";
import { localDateRangeToUtcBounds } from "./time";
import { parseManualIntervals } from "./manual-schedule";
import {
  CalendarAuthorizationError,
  getBroker,
  type BrokerId,
  type CalendarEventAttendee,
} from "./calendar";
import { freshGrantForConnection } from "./calendar/credentials";
import { parseWeeklyAvailability } from "./weekly-availability";
import {
  confirmationEmail,
  noSlotsEmail,
  proposalEmail,
  reminderEmail,
  sendTrackedEmail,
} from "./email";

const MAX_QUEUED_SLOTS = 40;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Conditional status transition.
 *
 * Every state change is `WHERE status = <expected>`, so two concurrent callers
 * cannot both believe they moved the event. The boolean return is how a caller
 * learns whether it won the race and owns the follow-up work.
 */
async function transition(
  eventId: string,
  from: EventStatus | EventStatus[],
  to: EventStatus,
  extra: Partial<typeof events.$inferInsert> = {}
): Promise<boolean> {
  const fromStates = Array.isArray(from) ? from : [from];
  const updated = await db
    .update(events)
    .set({ status: to, updatedAt: now(), ...extra })
    .where(and(eq(events.id, eventId), inArray(events.status, fromStates)))
    .returning({ id: events.id });
  return updated.length === 1;
}

export interface EventContext {
  event: Event;
  participants: Participant[];
  connections: Map<string, CalendarConnection>;
}

export async function loadEventContext(eventId: string): Promise<EventContext | null> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) return null;

  const rows = await db.query.participants.findMany({
    where: eq(participants.eventId, eventId),
  });
  const ids = rows.map((row) => row.id);
  const connectionRows = ids.length
    ? await db.query.calendarConnections.findMany({
        where: inArray(calendarConnections.participantId, ids),
      })
    : [];

  return {
    event,
    participants: rows,
    connections: new Map(connectionRows.map((row) => [row.participantId, row])),
  };
}

/** Participants who still count toward scheduling. */
export function activeParticipants(context: EventContext): Participant[] {
  return context.participants.filter((p) => p.status !== "removed");
}

/** Participants whose connected calendar or reviewed manual schedule contributes. */
export function contributingParticipants(context: EventContext): Participant[] {
  return activeParticipants(context).filter(
    (p) =>
      p.status === "joined" &&
      (context.connections.get(p.id)?.status === "connected" ||
        p.availabilityJson !== null)
  );
}

export type BusyFetch =
  | { ok: true; busyByParticipant: Interval[][] }
  | { ok: false; relinkRequired: string[]; transient: string[] };

/**
 * Reads current busy time for everyone who has connected.
 *
 * A provider that refuses is never treated as "free" — that would confirm a
 * meeting over someone's existing commitment — and it is no longer treated as
 * "busy all window" either, because that silently produced "no times work".
 * Instead the failure surfaces so a human can act on it.
 */
export async function fetchBusy(
  context: EventContext,
  people: Participant[]
): Promise<BusyFetch> {
  const { startMs, endMs } = localDateRangeToUtcBounds(
    context.event.startDate,
    context.event.endDate,
    context.event.timezone
  );

  const relinkRequired: string[] = [];
  const transient: string[] = [];
  const busyByParticipant: Interval[][] = [];

  const results = await Promise.all(
    people.map(async (person) => {
      const connection = context.connections.get(person.id);
      if (!connection || connection.status !== "connected") {
        if (person.availabilityJson === null) {
          return { person, error: new Error("No availability source") };
        }
        const manual = parseManualIntervals(person.availabilityJson);
        return manual
          ? { person, busy: manual }
          : { person, error: new Error("Invalid manual availability") };
      }
      try {
        const broker = getBroker(connection.broker as BrokerId);
        const busy = await broker.getFreeBusy(await freshGrantForConnection(connection), {
          startMs,
          endMs,
        });
        return { person, busy };
      } catch (error) {
        return { person, error };
      }
    })
  );

  for (const result of results) {
    if ("error" in result && result.error) {
      if (result.error instanceof CalendarAuthorizationError) {
        relinkRequired.push(result.person.id);
        await db
          .update(calendarConnections)
          .set({
            status: "relink_required",
            lastError: result.error.message.slice(0, 500),
            updatedAt: now(),
          })
          .where(eq(calendarConnections.participantId, result.person.id));
      } else {
        transient.push(result.person.id);
      }
      continue;
    }
    busyByParticipant.push(result.busy ?? []);
  }

  if (relinkRequired.length > 0 || transient.length > 0) {
    return { ok: false, relinkRequired, transient };
  }
  return { ok: true, busyByParticipant };
}

/**
 * Moves an event forward after any participant change.
 *
 * Safe to call repeatedly and out of order: every step is guarded by a
 * conditional transition, so a duplicated OAuth callback, a retried job, and a
 * page load all converge on the same result rather than double-acting or
 * exiting early and stranding the event.
 */
export async function advanceEvent(eventId: string): Promise<void> {
  const context = await loadEventContext(eventId);
  if (!context) return;
  const { event } = context;

  if (event.status !== "gathering" && event.status !== "action_required") return;

  const active = activeParticipants(context);
  const everyoneAnswered = active.every(
    (p) => p.status === "joined" || p.status === "declined"
  );

  const deadlinePassed =
    event.responseDeadline !== null && event.responseDeadline <= now();

  const mayProceedWithoutHoldouts =
    deadlinePassed && event.nonresponderPolicy === "proceed_without";

  if (!everyoneAnswered && !mayProceedWithoutHoldouts) return;

  // Only recurse when there was actually someone to drop; otherwise this
  // branch would re-enter itself forever on an event whose deadline has passed
  // but where everyone already answered.
  if (!everyoneAnswered && mayProceedWithoutHoldouts) {
    const removed = await db
      .update(participants)
      .set({ status: "removed", removedAt: now() })
      .where(
        and(eq(participants.eventId, eventId), eq(participants.status, "pending"))
      )
      .returning({ id: participants.id });
    if (removed.length > 0) return advanceEvent(eventId);
    return;
  }

  const refreshed = await loadEventContext(eventId);
  if (!refreshed) return;
  const contributors = contributingParticipants(refreshed);

  // Everyone declined, or nobody ever connected. The old code proposed to an
  // empty audience and left the event stuck in `gathering` forever.
  if (contributors.length === 0) {
    if (await transition(eventId, ["gathering", "action_required"], "failed")) {
      await notifyNoSlots(refreshed);
    }
    return;
  }

  const busy = await fetchBusy(refreshed, contributors);
  if (!busy.ok) {
    await transition(eventId, ["gathering", "proposing"], "action_required", {
      calendarWriteError:
        busy.relinkRequired.length > 0
          ? "A participant's calendar needs to be reconnected."
          : "A calendar provider is temporarily unavailable.",
    });
    return;
  }

  const candidates = computeCandidateSlots({
    startDate: refreshed.event.startDate,
    endDate: refreshed.event.endDate,
    timezone: refreshed.event.timezone,
    durationMinutes: refreshed.event.durationMinutes,
    workingHoursStart: refreshed.event.workingHoursStart,
    workingHoursEnd: refreshed.event.workingHoursEnd,
    excludeWeekends: refreshed.event.excludeWeekends,
    weeklyAvailability: parseWeeklyAvailability(
      refreshed.event.weeklyAvailabilityJson
    ),
    busyByParticipant: busy.busyByParticipant,
    // Never propose a time that has already passed.
    notBeforeMs: Date.now(),
    maxSlots: MAX_QUEUED_SLOTS,
  });

  if (candidates.length === 0) {
    if (await transition(eventId, ["gathering", "action_required"], "failed")) {
      await notifyNoSlots(refreshed);
    }
    return;
  }

  // Claim the transition before writing slots, so only one caller queues them.
  if (!(await transition(eventId, ["gathering", "action_required"], "proposing"))) {
    return;
  }

  await db.delete(proposedSlots).where(
    and(eq(proposedSlots.eventId, eventId), eq(proposedSlots.status, "queued"))
  );

  await db.insert(proposedSlots).values(
    candidates.map(([startMs, endMs], rank) => ({
      id: uuidv4(),
      eventId,
      rank,
      startTime: Math.floor(startMs / 1000),
      endTime: Math.floor(endMs / 1000),
      status: "queued" as const,
    }))
  );

  await proposeNextSlot(eventId);
}

/**
 * Proposes the highest-ranked queued slot, rechecking availability first.
 *
 * The recheck matters because time passes between generating candidates and
 * asking about one; someone may have booked over it in the meantime.
 */
export async function proposeNextSlot(eventId: string): Promise<ProposedSlot | null> {
  const context = await loadEventContext(eventId);
  if (!context || context.event.status !== "proposing") return null;

  const alreadyProposed = await db.query.proposedSlots.findFirst({
    where: and(eq(proposedSlots.eventId, eventId), eq(proposedSlots.status, "proposed")),
  });
  if (alreadyProposed) return alreadyProposed;

  const contributors = contributingParticipants(context);
  const busy = await fetchBusy(context, contributors);

  const queued = await db.query.proposedSlots.findMany({
    where: and(eq(proposedSlots.eventId, eventId), eq(proposedSlots.status, "queued")),
    orderBy: [asc(proposedSlots.rank)],
  });

  for (const slot of queued) {
    const interval: Interval = [slot.startTime * 1000, slot.endTime * 1000];

    if (interval[0] <= Date.now()) {
      await expireSlot(slot.id);
      continue;
    }
    if (busy.ok && !isSlotStillFree(interval, busy.busyByParticipant)) {
      await expireSlot(slot.id);
      continue;
    }

    // Claim it: only the caller that flips queued -> proposed sends the email.
    const claimed = await db
      .update(proposedSlots)
      .set({ status: "proposed", proposedAt: now() })
      .where(and(eq(proposedSlots.id, slot.id), eq(proposedSlots.status, "queued")))
      .returning();
    if (claimed.length !== 1) continue;

    await notifyProposal(context, claimed[0]);
    return claimed[0];
  }

  // Nothing survived the recheck.
  if (await transition(eventId, "proposing", "failed")) {
    await notifyNoSlots(context);
  }
  return null;
}

async function expireSlot(slotId: string): Promise<void> {
  await db
    .update(proposedSlots)
    .set({ status: "expired", decidedAt: now() })
    .where(and(eq(proposedSlots.id, slotId), eq(proposedSlots.status, "queued")));
}

/**
 * Decides a proposed slot once everyone has answered.
 *
 * Idempotent: the slot transition is conditional, so a duplicated response
 * callback, a retry, and two people answering simultaneously all converge.
 */
export async function finalizeSlotIfReady(slotId: string): Promise<void> {
  const slot = await db.query.proposedSlots.findFirst({
    where: eq(proposedSlots.id, slotId),
  });
  if (!slot || slot.status !== "proposed") return;

  const context = await loadEventContext(slot.eventId);
  if (!context || context.event.status !== "proposing") return;

  const contributors = contributingParticipants(context);
  const responses = await db.query.slotResponses.findMany({
    where: eq(slotResponses.proposedSlotId, slotId),
  });

  const answered = new Set(responses.map((response) => response.participantId));
  if (!contributors.every((person) => answered.has(person.id))) return;

  const declined = responses.some((response) => response.response === "declined");

  if (declined) {
    const rejected = await db
      .update(proposedSlots)
      .set({ status: "rejected", decidedAt: now() })
      .where(and(eq(proposedSlots.id, slotId), eq(proposedSlots.status, "proposed")))
      .returning();
    if (rejected.length !== 1) return; // someone else already handled it
    await proposeNextSlot(slot.eventId);
    return;
  }

  const confirmed = await db
    .update(proposedSlots)
    .set({ status: "confirmed", decidedAt: now() })
    .where(and(eq(proposedSlots.id, slotId), eq(proposedSlots.status, "proposed")))
    .returning();
  if (confirmed.length !== 1) return;

  // Agreed, but not yet real: `scheduling` is deliberately not `confirmed`.
  await transition(slot.eventId, "proposing", "scheduling", {
    confirmedSlotId: slotId,
    calendarWriteStatus: "pending",
  });

  await writeConfirmedMeeting(slot.eventId);
}

/**
 * Creates the meeting on the organizer's calendar, then tells everyone.
 *
 * Availability is rechecked one last time here — this is the last moment the
 * app can notice that the agreed time stopped working. The write itself is
 * idempotent on a key derived from the event and slot, so retrying after a
 * timeout cannot produce two meetings.
 */
export async function writeConfirmedMeeting(eventId: string): Promise<void> {
  const context = await loadEventContext(eventId);
  if (!context) return;
  const { event } = context;
  if (event.status !== "scheduling" && event.status !== "action_required") return;
  if (!event.confirmedSlotId) return;

  const slot = await db.query.proposedSlots.findFirst({
    where: eq(proposedSlots.id, event.confirmedSlotId),
  });
  if (!slot) return;

  const organizer = context.participants.find((p) => p.role === "organizer");
  const organizerConnection = organizer
    ? context.connections.get(organizer.id)
    : undefined;

  const attendees: CalendarEventAttendee[] = activeParticipants(context)
    .filter((p) => p.status === "joined")
    .map((p) => ({ email: p.email, displayName: p.name ?? undefined }));

  const interval: Interval = [slot.startTime * 1000, slot.endTime * 1000];
  const busy = await fetchBusy(context, contributingParticipants(context));
  if (busy.ok && !isSlotStillFree(interval, busy.busyByParticipant)) {
    // Someone booked over the agreed time between confirming and writing.
    await db
      .update(proposedSlots)
      .set({ status: "expired", decidedAt: now() })
      .where(eq(proposedSlots.id, slot.id));
    await transition(eventId, ["scheduling", "action_required"], "proposing", {
      confirmedSlotId: null,
      calendarWriteStatus: "not_attempted",
      calendarWriteError: "The agreed time stopped working before it was booked.",
    });
    await proposeNextSlot(eventId);
    return;
  }

  let calendarWritten = false;
  let writeError: string | null = null;

  // Direct providers support a default-calendar route. Broker calendar ids are
  // opaque, so guessing one there would write the meeting nowhere and report
  // success.
  const destination =
    organizerConnection?.destinationCalendarId ??
    (organizerConnection?.broker === "google" ||
    organizerConnection?.broker === "microsoft"
      ? "primary"
      : null);

  if (organizerConnection && destination && organizerConnection.status === "connected") {
    try {
      const broker = getBroker(organizerConnection.broker as BrokerId);
      const result = await broker.createEvent(
        await freshGrantForConnection(organizerConnection),
        {
          // Stable across every retry of this event+slot pair.
          idempotencyKey: `get2gethr-${event.id}-${slot.id}`,
          calendarId: destination,
          title: event.title,
          description: event.description ?? undefined,
          startMs: interval[0],
          endMs: interval[1],
          timezone: event.timezone,
          organizer: {
            email: event.organizerEmail,
            displayName: event.organizerName,
          },
          attendees,
        }
      );
      calendarWritten = true;
      await db
        .update(events)
        .set({
          externalEventId: result.externalEventId,
          calendarWriteStatus: "written",
          calendarWriteError: null,
          updatedAt: now(),
        })
        .where(eq(events.id, eventId));
    } catch (error) {
      writeError = error instanceof Error ? error.message : String(error);
    }
  } else {
    writeError = "The organizer has no connected calendar to write the meeting to.";
  }

  if (!calendarWritten) {
    await db
      .update(events)
      .set({
        calendarWriteStatus: "failed",
        calendarWriteError: writeError?.slice(0, 500) ?? "Calendar write failed",
        updatedAt: now(),
      })
      .where(eq(events.id, eventId));
  }

  // The time is agreed either way, so everyone is told either way — but the
  // event only reads "confirmed" when the meeting actually exists on a
  // calendar. Otherwise it is `action_required` and the ICS attachment is the
  // way in.
  await transition(
    eventId,
    ["scheduling", "action_required"],
    calendarWritten ? "confirmed" : "action_required"
  );

  await notifyConfirmation(context, slot, calendarWritten);
}

/** Organizer-triggered retry after a calendar write failure. */
export async function retryCalendarWrite(eventId: string): Promise<void> {
  await db
    .update(events)
    .set({ calendarWriteStatus: "pending", updatedAt: now() })
    .where(and(eq(events.id, eventId), eq(events.calendarWriteStatus, "failed")));
  await writeConfirmedMeeting(eventId);
}

/** Sends reminders to everyone who has not answered yet. */
export async function remindNonresponders(eventId: string): Promise<number> {
  const context = await loadEventContext(eventId);
  if (!context) return 0;

  const waiting = activeParticipants(context).filter((p) => p.status === "pending");
  let sent = 0;

  for (const person of waiting) {
    const result = await sendTrackedEmail(
      reminderEmail(
        context.event,
        person.email,
        person.inviteToken,
        context.event.responseDeadline ? context.event.responseDeadline * 1000 : null,
        context.event.timezone
      ),
      {
        eventId,
        participantId: person.id,
        kind: "reminder",
        // One reminder per person per day, enforced by the ledger's unique key.
        idempotencyKey: `reminder:${person.id}:${Math.floor(now() / 86400)}`,
      }
    );
    if (result.status === "sent") {
      sent += 1;
      await db
        .update(participants)
        .set({ lastRemindedAt: now() })
        .where(eq(participants.id, person.id));
    }
  }
  return sent;
}

export async function cancelEvent(eventId: string): Promise<boolean> {
  return transition(
    eventId,
    ["draft", "gathering", "proposing", "scheduling", "action_required", "failed"],
    "cancelled",
    { cancelledAt: now() }
  );
}

/**
 * Organizer override: accept the currently proposed slot without waiting for
 * the remaining responses.
 */
export async function forceConfirmCurrentSlot(eventId: string): Promise<boolean> {
  const slot = await db.query.proposedSlots.findFirst({
    where: and(eq(proposedSlots.eventId, eventId), eq(proposedSlots.status, "proposed")),
  });
  if (!slot) return false;

  const confirmed = await db
    .update(proposedSlots)
    .set({ status: "confirmed", decidedAt: now() })
    .where(and(eq(proposedSlots.id, slot.id), eq(proposedSlots.status, "proposed")))
    .returning();
  if (confirmed.length !== 1) return false;

  await transition(eventId, "proposing", "scheduling", {
    confirmedSlotId: slot.id,
    calendarWriteStatus: "pending",
  });
  await writeConfirmedMeeting(eventId);
  return true;
}

// --- Notifications --------------------------------------------------------

async function notifyProposal(context: EventContext, slot: ProposedSlot): Promise<void> {
  for (const person of contributingParticipants(context)) {
    await sendTrackedEmail(
      proposalEmail(context.event, slot, person.email, person.inviteToken),
      {
        eventId: context.event.id,
        participantId: person.id,
        kind: "proposal",
        idempotencyKey: `proposal:${slot.id}:${person.id}`,
      }
    );
  }
}

async function notifyConfirmation(
  context: EventContext,
  slot: ProposedSlot,
  calendarWritten: boolean
): Promise<void> {
  const attending = activeParticipants(context).filter((p) => p.status === "joined");
  const attendeeList = attending.map((p) => ({ email: p.email, name: p.name }));

  for (const person of attending) {
    await sendTrackedEmail(
      confirmationEmail(context.event, slot, person.email, attendeeList, {
        calendarWritten,
      }),
      {
        eventId: context.event.id,
        participantId: person.id,
        kind: "confirmation",
        idempotencyKey: `confirmation:${slot.id}:${person.id}`,
      }
    );
  }
}

async function notifyNoSlots(context: EventContext): Promise<void> {
  const recipients = new Map<string, string | null>();
  recipients.set(context.event.organizerEmail, null);
  for (const person of activeParticipants(context)) {
    if (person.status !== "declined") recipients.set(person.email, person.id);
  }

  for (const [email, participantId] of recipients) {
    await sendTrackedEmail(noSlotsEmail(context.event, email), {
      eventId: context.event.id,
      participantId,
      kind: "no_slots",
      idempotencyKey: `no_slots:${context.event.id}:${email}`,
    });
  }
}

/** Participants still holding the event up. Used by the organizer surface. */
export async function pendingParticipants(eventId: string): Promise<Participant[]> {
  return db.query.participants.findMany({
    where: and(
      eq(participants.eventId, eventId),
      eq(participants.status, "pending"),
      ne(participants.role, "organizer")
    ),
  });
}
