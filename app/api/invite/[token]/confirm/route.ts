import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { db, ensureMigrated } from "@/lib/db";
import { proposedSlots, slotResponses } from "@/lib/db/schema";
import { AuthorizationError, authorizeInvite } from "@/lib/authorization";
import { finalizeSlotIfReady } from "@/lib/scheduler";
import { zodToApiError } from "@/lib/validation";
import {
  clientIdentifier,
  consumeRateLimit,
  INVITE_RESPONSE_PER_IP,
} from "@/lib/rate-limit";

const ConfirmSchema = z.object({
  response: z.enum(["confirmed", "declined"]),
  /** Guards against answering a slot that was replaced while the page sat open. */
  slotId: z.string().uuid().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    await ensureMigrated();

    const limit = await consumeRateLimit(INVITE_RESPONSE_PER_IP, clientIdentifier(req));
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const parsed = ConfirmSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(zodToApiError(parsed.error), { status: 400 });
    }
    const { response, slotId } = parsed.data;

    const audience = await authorizeInvite(token);
    const participant = audience.participant;
    if (!participant || participant.status !== "joined") {
      return NextResponse.json(
        { error: "Connect your calendar before responding to a time." },
        { status: 409 }
      );
    }

    const slot = await db.query.proposedSlots.findFirst({
      where: and(
        eq(proposedSlots.eventId, audience.event.id),
        eq(proposedSlots.status, "proposed")
      ),
    });
    if (!slot) {
      return NextResponse.json(
        { error: "There is no time waiting for your answer right now." },
        { status: 409 }
      );
    }

    // If the client was looking at a different slot, tell it to refresh rather
    // than silently recording an answer to a question nobody asked.
    if (slotId && slotId !== slot.id) {
      return NextResponse.json(
        {
          error: "This time was replaced while you were deciding. Take another look.",
          currentSlotId: slot.id,
        },
        { status: 409 }
      );
    }

    try {
      await db.insert(slotResponses).values({
        id: uuidv4(),
        proposedSlotId: slot.id,
        participantId: participant.id,
        response,
      });
    } catch {
      // The unique index on (slot, participant) is what makes a duplicated
      // submission harmless. Fall through and let finalization re-run: the
      // previous attempt may have died before it finished.
    }

    await finalizeSlotIfReady(slot.id);

    const after = await db.query.proposedSlots.findFirst({
      where: eq(proposedSlots.id, slot.id),
    });

    return NextResponse.json({
      ok: true,
      recorded: response,
      slotStatus: after?.status ?? slot.status,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("POST /api/invite/[token]/confirm error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
