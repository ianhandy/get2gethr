import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { participants } from "@/lib/db/schema";


export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const participant = await db.query.participants.findFirst({
      where: eq(participants.inviteToken, token),
    });
    if (!participant) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
    }

    const event = await db.query.events.findFirst({
      where: (e, { eq: deq }) => deq(e.id, participant.eventId),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    return NextResponse.json({
      participant: {
        id: participant.id,
        email: participant.email,
        name: participant.name,
        status: participant.status,
      },
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        initiatorName: event.initiatorName,
        initiatorEmail: event.initiatorEmail,
        dateRangeStart: event.dateRangeStart,
        dateRangeEnd: event.dateRangeEnd,
        durationMinutes: event.durationMinutes,
        timezone: event.timezone,
        status: event.status,
      },
    });
  } catch (err) {
    console.error("GET /api/invite/[token] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
