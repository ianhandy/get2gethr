import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, participants, proposedSlots } from "@/lib/db/schema";


export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const event = await db.query.events.findFirst({
      where: eq(events.id, id),
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const eventParticipants = await db.query.participants.findMany({
      where: eq(participants.eventId, id),
    });

    const currentSlot = await db.query.proposedSlots.findFirst({
      where: (s, { and, eq: deq }) =>
        and(deq(s.eventId, id), deq(s.status, "proposed")),
    });

    return NextResponse.json({
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        initiatorEmail: event.initiatorEmail,
        initiatorName: event.initiatorName,
        dateRangeStart: event.dateRangeStart,
        dateRangeEnd: event.dateRangeEnd,
        durationMinutes: event.durationMinutes,
        timezone: event.timezone,
        status: event.status,
        createdAt: event.createdAt,
      },
      participants: eventParticipants.map((p) => ({
        id: p.id,
        email: p.email,
        name: p.name,
        status: p.status,
        joinedAt: p.joinedAt,
      })),
      currentSlot: currentSlot
        ? {
            id: currentSlot.id,
            startTime: currentSlot.startTime,
            endTime: currentSlot.endTime,
            slotIndex: currentSlot.slotIndex,
          }
        : null,
    });
  } catch (err) {
    console.error("GET /api/events/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
