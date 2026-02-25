import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import {
  participants,
  proposedSlots,
  slotResponses,
} from "@/lib/db/schema";
import { checkAndFinalizeSlot } from "@/lib/scheduler";
import { z } from "zod";


const ConfirmSchema = z.object({
  response: z.enum(["confirmed", "declined"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const body = await req.json();
    const { response } = ConfirmSchema.parse(body);

    const participant = await db.query.participants.findFirst({
      where: eq(participants.inviteToken, token),
    });
    if (!participant || participant.status !== "joined") {
      return NextResponse.json({ error: "Invalid or unauthorized" }, { status: 404 });
    }

    // Find current proposed slot for this event
    const slot = await db.query.proposedSlots.findFirst({
      where: and(
        eq(proposedSlots.eventId, participant.eventId),
        eq(proposedSlots.status, "proposed")
      ),
    });
    if (!slot) {
      return NextResponse.json({ error: "No active proposed slot" }, { status: 404 });
    }

    // Check if participant already responded
    const existing = await db.query.slotResponses.findFirst({
      where: and(
        eq(slotResponses.proposedSlotId, slot.id),
        eq(slotResponses.participantId, participant.id)
      ),
    });
    if (existing) {
      return NextResponse.json({ error: "Already responded" }, { status: 409 });
    }

    await db.insert(slotResponses).values({
      id: uuidv4(),
      proposedSlotId: slot.id,
      participantId: participant.id,
      response,
    });

    await checkAndFinalizeSlot(slot.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    console.error("POST /api/invite/[token]/confirm error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
