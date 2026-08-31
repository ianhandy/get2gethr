import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureMigrated } from "@/lib/db";
import { proposedSlots } from "@/lib/db/schema";
import {
  AuthorizationError,
  authorizeInvite,
  eventViewFor,
} from "@/lib/authorization";
import { advanceEvent, loadEventContext } from "@/lib/scheduler";
import { supportedProviders } from "@/lib/calendar";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    await ensureMigrated();
    const audience = await authorizeInvite(token);
    const eventId = audience.event.id;

    // Loading an invitation is a cheap, safe moment to nudge an event that got
    // stuck — for instance because a side effect failed after the last
    // participant joined. `advanceEvent` is idempotent, so this cannot
    // double-act.
    await advanceEvent(eventId).catch((error) => {
      console.error("advanceEvent from invite view failed:", error);
    });

    const context = await loadEventContext(eventId);
    if (!context) throw new AuthorizationError(404, "Invitation not found");

    const currentSlot = await db.query.proposedSlots.findFirst({
      where: and(
        eq(proposedSlots.eventId, eventId),
        eq(proposedSlots.status, "proposed")
      ),
    });
    const confirmedSlot = context.event.confirmedSlotId
      ? ((await db.query.proposedSlots.findFirst({
          where: eq(proposedSlots.id, context.event.confirmedSlotId),
        })) ?? null)
      : null;

    const view = eventViewFor(audience, {
      event: context.event,
      participants: context.participants,
      connections: context.connections,
      currentSlot: currentSlot ?? null,
      confirmedSlot,
    });

    return NextResponse.json({
      ...view,
      // The invite page says "Connect calendar", not "Connect Google Calendar".
      providers: supportedProviders(),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("GET /api/invite/[token] error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
