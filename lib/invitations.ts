import { eq } from "drizzle-orm";
import { db } from "./db";
import { events, participants } from "./db/schema";
import { cancelledEmail, inviteEmail, sendTrackedEmail } from "./email";

export interface InvitationResult {
  sent: number;
  failed: Array<{ email: string; error: string }>;
}

/**
 * Sends the outstanding invitations for an event.
 *
 * Called once the organizer has connected a calendar, and again by the
 * organizer's "resend" action. The ledger's idempotency key means a resend
 * never duplicates an invitation that already went out; a previously failed
 * send is retried.
 */
export async function sendInvitations(
  eventId: string,
  options: { force?: boolean } = {}
): Promise<InvitationResult> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) return { sent: 0, failed: [] };

  const rows = await db.query.participants.findMany({
    where: eq(participants.eventId, eventId),
  });

  const result: InvitationResult = { sent: 0, failed: [] };

  for (const person of rows) {
    if (person.role === "organizer") continue;
    if (person.status !== "pending") continue;

    const outcome = await sendTrackedEmail(
      inviteEmail(event, person.email, person.inviteToken),
      {
        eventId,
        participantId: person.id,
        kind: "invite",
        // A forced resend gets a fresh key so it is a genuinely new send
        // rather than a silently skipped duplicate.
        idempotencyKey: options.force
          ? `invite:${person.id}:${Math.floor(Date.now() / 1000)}`
          : `invite:${person.id}`,
      }
    );

    if (outcome.status === "sent") {
      result.sent += 1;
      await db
        .update(participants)
        .set({ invitedAt: Math.floor(Date.now() / 1000) })
        .where(eq(participants.id, person.id));
    } else if (outcome.status === "failed") {
      result.failed.push({ email: person.email, error: outcome.error });
    }
  }

  return result;
}

/** Tells everyone an event was called off. */
export async function notifyCancellation(eventId: string): Promise<number> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) return 0;

  const rows = await db.query.participants.findMany({
    where: eq(participants.eventId, eventId),
  });

  let sent = 0;
  for (const person of rows) {
    if (person.status === "removed" || person.role === "organizer") continue;
    const outcome = await sendTrackedEmail(cancelledEmail(event, person.email), {
      eventId,
      participantId: person.id,
      kind: "cancelled",
      idempotencyKey: `cancelled:${person.id}`,
    });
    if (outcome.status === "sent") sent += 1;
  }
  return sent;
}
