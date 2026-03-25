import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { db, ensureMigrated } from "@/lib/db";
import { events, participants } from "@/lib/db/schema";
import { sendInviteEmail } from "@/lib/email";


const CreateEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  initiatorEmail: z.string().email(),
  initiatorName: z.string().min(1).max(100),
  dateRangeStart: z.number().int(), // Unix timestamp
  dateRangeEnd: z.number().int(),
  durationMinutes: z.number().int().min(15).max(480),
  workingHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
  workingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string(),
  excludeWeekends: z.boolean().default(true),
  participantEmails: z.array(z.string().email()).min(1).max(20),
});

export async function POST(req: NextRequest) {
  try {
    await ensureMigrated();
    const body = await req.json();
    const data = CreateEventSchema.parse(body);

    if (data.dateRangeEnd <= data.dateRangeStart) {
      return NextResponse.json(
        { error: "End date must be after start date" },
        { status: 400 }
      );
    }

    const eventId = uuidv4();

    await db.insert(events).values({
      id: eventId,
      title: data.title,
      description: data.description ?? null,
      initiatorEmail: data.initiatorEmail,
      initiatorName: data.initiatorName,
      dateRangeStart: data.dateRangeStart,
      dateRangeEnd: data.dateRangeEnd,
      durationMinutes: data.durationMinutes,
      workingHoursStart: data.workingHoursStart,
      workingHoursEnd: data.workingHoursEnd,
      timezone: data.timezone,
      excludeWeekends: data.excludeWeekends,
    });

    // Create a participant row for each invited email
    const participantRows = data.participantEmails.map((email) => ({
      id: uuidv4(),
      eventId,
      email,
      inviteToken: uuidv4(),
    }));

    await db.insert(participants).values(participantRows);

    // Send invite emails
    const event = (await db.query.events.findFirst({
      where: (e, { eq }) => eq(e.id, eventId),
    }))!;

    await Promise.allSettled(
      participantRows.map((p) => sendInviteEmail(p.email, event, p.inviteToken))
    );

    return NextResponse.json({ eventId }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    console.error("POST /api/events error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
