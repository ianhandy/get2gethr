import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureMigrated } from "@/lib/db";
import { participants } from "@/lib/db/schema";
import { checkAndAdvanceEvent } from "@/lib/scheduler";


export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    await ensureMigrated();
    const participant = await db.query.participants.findFirst({
      where: eq(participants.inviteToken, token),
    });
    if (!participant) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
    }
    if (participant.status !== "pending") {
      return NextResponse.json(
        { error: "Invitation already responded to" },
        { status: 409 }
      );
    }

    await db
      .update(participants)
      .set({ status: "declined" })
      .where(eq(participants.inviteToken, token));

    await checkAndAdvanceEvent(participant.eventId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/invite/[token]/decline error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
