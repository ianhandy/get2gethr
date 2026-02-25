import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db";
import { events, participants, proposedSlots, slotResponses } from "./db/schema";
import { computeFreeSlots, chopIntoSlots } from "./availability";
import {
  sendProposalEmail,
  sendConfirmationEmail,
  sendNoSlotsEmail,
} from "./email";
import { decrypt } from "./crypto";
import { getFreeBusy } from "./google-calendar";

/**
 * Called after a participant joins or declines.
 * Checks if all participants have responded; if so, computes slots and proposes.
 */
export async function checkAndAdvanceEvent(eventId: string): Promise<void> {
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event || event.status !== "gathering") return;

  const allParticipants = await db.query.participants.findMany({
    where: eq(participants.eventId, eventId),
  });

  const allResponded = allParticipants.every(
    (p) => p.status === "joined" || p.status === "declined"
  );
  if (!allResponded) return;

  const joinedParticipants = allParticipants.filter((p) => p.status === "joined");

  // Gather busy slots from each joined participant
  const participantBusySlots = await Promise.all(
    joinedParticipants.map(async (p) => {
      if (!p.googleAccessToken || !p.googleRefreshToken) return [];
      try {
        const accessToken = decrypt(p.googleAccessToken);
        const refreshToken = decrypt(p.googleRefreshToken);
        return await getFreeBusy(
          accessToken,
          refreshToken,
          new Date(event.dateRangeStart * 1000),
          new Date(event.dateRangeEnd * 1000)
        );
      } catch {
        // If we can't fetch, treat as fully busy to be safe
        return [[event.dateRangeStart * 1000, event.dateRangeEnd * 1000]] as [number, number][];
      }
    })
  );

  const freeIntervals = computeFreeSlots({
    dateRangeStartMs: event.dateRangeStart * 1000,
    dateRangeEndMs: event.dateRangeEnd * 1000,
    durationMinutes: event.durationMinutes,
    workingHoursStart: event.workingHoursStart,
    workingHoursEnd: event.workingHoursEnd,
    timezone: event.timezone,
    excludeWeekends: event.excludeWeekends,
    participantBusySlots,
  });

  const candidateSlots = chopIntoSlots(freeIntervals, event.durationMinutes);

  if (candidateSlots.length === 0) {
    // No common slots — mark failed
    await db.update(events).set({ status: "failed" }).where(eq(events.id, eventId));
    const allEmails = [
      event.initiatorEmail,
      ...allParticipants.map((p) => p.email),
    ];
    await Promise.all(allEmails.map((email) => sendNoSlotsEmail(email, event)));
    return;
  }

  // Save all candidate slots
  const slotRows = candidateSlots.map(([start, end], i) => ({
    id: uuidv4(),
    eventId,
    slotIndex: i,
    startTime: Math.floor(start / 1000),
    endTime: Math.floor(end / 1000),
    status: "proposed" as const,
  }));
  await db.insert(proposedSlots).values(slotRows);

  // Propose the first slot
  await proposeSlot(eventId, 0, allParticipants.map((p) => p.email));

  await db.update(events).set({ status: "proposing" }).where(eq(events.id, eventId));
}

async function proposeSlot(
  eventId: string,
  slotIndex: number,
  emails: string[]
): Promise<void> {
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });
  if (!event) return;

  const slot = await db.query.proposedSlots.findFirst({
    where: and(
      eq(proposedSlots.eventId, eventId),
      eq(proposedSlots.slotIndex, slotIndex)
    ),
  });
  if (!slot) return;

  const allParticipants = await db.query.participants.findMany({
    where: eq(participants.eventId, eventId),
  });

  await Promise.all(
    allParticipants
      .filter((p) => p.status === "joined")
      .map((p) => sendProposalEmail(p.email, event, slot, p.inviteToken))
  );
}

/**
 * Called after a participant confirms or declines a proposed slot.
 */
export async function checkAndFinalizeSlot(
  proposedSlotId: string
): Promise<void> {
  const slot = await db.query.proposedSlots.findFirst({
    where: eq(proposedSlots.id, proposedSlotId),
  });
  if (!slot || slot.status !== "proposed") return;

  const event = await db.query.events.findFirst({
    where: eq(events.id, slot.eventId),
  });
  if (!event || event.status !== "proposing") return;

  const joinedParticipants = await db.query.participants.findMany({
    where: and(
      eq(participants.eventId, slot.eventId),
      eq(participants.status, "joined")
    ),
  });

  const responses = await db.query.slotResponses.findMany({
    where: eq(slotResponses.proposedSlotId, proposedSlotId),
  });

  const allResponded = joinedParticipants.every((p) =>
    responses.some((r) => r.participantId === p.id)
  );
  if (!allResponded) return;

  const anyDeclined = responses.some((r) => r.response === "declined");

  if (!anyDeclined) {
    // All confirmed!
    await db
      .update(proposedSlots)
      .set({ status: "confirmed" })
      .where(eq(proposedSlots.id, proposedSlotId));
    await db
      .update(events)
      .set({ status: "confirmed" })
      .where(eq(events.id, slot.eventId));

    const allEmails = [
      event.initiatorEmail,
      ...joinedParticipants.map((p) => p.email),
    ];
    await Promise.all(
      allEmails.map((email) => sendConfirmationEmail(email, event, slot))
    );
    return;
  }

  // Someone declined — try next slot
  await db
    .update(proposedSlots)
    .set({ status: "rejected" })
    .where(eq(proposedSlots.id, proposedSlotId));

  const nextSlot = await db.query.proposedSlots.findFirst({
    where: and(
      eq(proposedSlots.eventId, slot.eventId),
      eq(proposedSlots.slotIndex, slot.slotIndex + 1)
    ),
  });

  if (!nextSlot) {
    // No more slots
    await db
      .update(events)
      .set({ status: "failed" })
      .where(eq(events.id, slot.eventId));
    const allEmails = [
      event.initiatorEmail,
      ...joinedParticipants.map((p) => p.email),
    ];
    await Promise.all(allEmails.map((email) => sendNoSlotsEmail(email, event)));
    return;
  }

  await proposeSlot(slot.eventId, nextSlot.slotIndex, joinedParticipants.map((p) => p.email));
}
