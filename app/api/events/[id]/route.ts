import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, ensureMigrated } from "@/lib/db";
import { events, participants, proposedSlots } from "@/lib/db/schema";
import {
  AuthorizationError,
  authorizeOrganizer,
  eventViewFor,
  readOrganizerToken,
  type EventViewInput,
} from "@/lib/authorization";
import { loadEventContext } from "@/lib/scheduler";
import {
  advanceEvent,
  cancelEvent,
  forceConfirmCurrentSlot,
  remindNonresponders,
  retryCalendarWrite,
} from "@/lib/scheduler";
import { notifyCancellation, sendInvitations } from "@/lib/invitations";
import { zodToApiError } from "@/lib/validation";

async function buildView(eventId: string): Promise<EventViewInput | null> {
  const context = await loadEventContext(eventId);
  if (!context) return null;

  const currentSlot = await db.query.proposedSlots.findFirst({
    where: and(eq(proposedSlots.eventId, eventId), eq(proposedSlots.status, "proposed")),
  });
  const confirmedSlot = context.event.confirmedSlotId
    ? ((await db.query.proposedSlots.findFirst({
        where: eq(proposedSlots.id, context.event.confirmedSlotId),
      })) ?? null)
    : null;

  return {
    event: context.event,
    participants: context.participants,
    connections: context.connections,
    currentSlot: currentSlot ?? null,
    confirmedSlot,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("/api/events/[id] error:", error);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await ensureMigrated();
    // An event UUID alone is no longer enough: the organizer proves it with a
    // separate capability that never appears in an invitation email.
    const audience = await authorizeOrganizer(id, readOrganizerToken(req));
    const view = await buildView(id);
    if (!view) throw new AuthorizationError(404, "Event not found");
    return NextResponse.json(eventViewFor(audience, view));
  } catch (error) {
    return errorResponse(error);
  }
}

const ActionSchema = z.object({
  action: z.enum([
    "send_invitations",
    "resend_invitations",
    "remind",
    "cancel",
    "force_confirm",
    "retry_calendar_write",
    "remove_participant",
    "advance",
  ]),
  participantId: z.string().uuid().optional(),
});

/** Organizer controls: resend, remind, remove, override, cancel, retry. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await ensureMigrated();
    await authorizeOrganizer(id, readOrganizerToken(req));

    const parsed = ActionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(zodToApiError(parsed.error), { status: 400 });
    }
    const { action, participantId } = parsed.data;

    switch (action) {
      case "send_invitations":
      case "resend_invitations": {
        const result = await sendInvitations(id, {
          force: action === "resend_invitations",
        });
        return NextResponse.json({ ok: true, ...result });
      }

      case "remind": {
        const sent = await remindNonresponders(id);
        return NextResponse.json({ ok: true, sent });
      }

      case "cancel": {
        const cancelled = await cancelEvent(id);
        if (cancelled) await notifyCancellation(id);
        return NextResponse.json({ ok: cancelled });
      }

      case "force_confirm": {
        const confirmed = await forceConfirmCurrentSlot(id);
        return NextResponse.json({
          ok: confirmed,
          error: confirmed ? undefined : "There is no time currently proposed.",
        });
      }

      case "retry_calendar_write": {
        await retryCalendarWrite(id);
        const event = await db.query.events.findFirst({ where: eq(events.id, id) });
        return NextResponse.json({
          ok: event?.calendarWriteStatus === "written",
          calendarWriteStatus: event?.calendarWriteStatus,
          calendarWriteError: event?.calendarWriteError,
        });
      }

      case "remove_participant": {
        if (!participantId) {
          return NextResponse.json(
            { error: "Say which participant to remove." },
            { status: 400 }
          );
        }
        const removed = await db
          .update(participants)
          .set({ status: "removed", removedAt: Math.floor(Date.now() / 1000) })
          .where(
            and(
              eq(participants.id, participantId),
              eq(participants.eventId, id),
              // The organizer cannot remove themselves; that is what cancel is.
              eq(participants.role, "attendee")
            )
          )
          .returning();
        if (removed.length === 0) {
          return NextResponse.json(
            { error: "That participant is not part of this event." },
            { status: 404 }
          );
        }
        // Removing the last holdout may be exactly what unblocks the event.
        await advanceEvent(id);
        return NextResponse.json({ ok: true });
      }

      case "advance": {
        await advanceEvent(id);
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}
