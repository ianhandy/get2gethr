import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { db, ensureMigrated } from "@/lib/db";
import { events, participants } from "@/lib/db/schema";
import { generateToken, hashIdentifier } from "@/lib/crypto";
import { localDateRangeToUtcBounds } from "@/lib/time";
import { CreateEventSchema, zodToApiError } from "@/lib/validation";
import {
  clientIdentifier,
  consumeAll,
  EVENT_CREATION_PER_EMAIL,
  EVENT_CREATION_PER_IP,
  EVENT_CREATION_PER_IP_DAILY,
  rateLimitHeaders,
} from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    await ensureMigrated();

    const ip = clientIdentifier(req);
    const body = await req.json();
    const parsed = CreateEventSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(zodToApiError(parsed.error), { status: 400 });
    }
    const data = parsed.data;

    // The honeypot field is invisible to people and irresistible to bots.
    // Accept the request so the bot learns nothing, but do no work.
    if (data.website) {
      return NextResponse.json({ eventId: uuidv4() }, { status: 201 });
    }

    // This endpoint is unauthenticated and sends mail, so it is throttled by
    // address and by organizer identity before anything is written.
    const limit = await consumeAll([
      { rule: EVENT_CREATION_PER_IP, identifier: ip },
      { rule: EVENT_CREATION_PER_IP_DAILY, identifier: ip },
      { rule: EVENT_CREATION_PER_EMAIL, identifier: data.organizerEmail.toLowerCase() },
    ]);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error:
            "That's a lot of events in a short time. Try again a little later.",
        },
        { status: 429, headers: rateLimitHeaders(limit.result) }
      );
    }

    // A retried submission must not create a second event and a second round
    // of invitations.
    const idempotencyKey = req.headers.get("idempotency-key")?.trim() || null;
    if (idempotencyKey) {
      const existing = await db.query.events.findFirst({
        where: eq(events.idempotencyKey, idempotencyKey),
      });
      if (existing) {
        return NextResponse.json(
          { eventId: existing.id, organizerToken: existing.organizerToken },
          { status: 200 }
        );
      }
    }

    const { startMs, endMs } = localDateRangeToUtcBounds(
      data.startDate,
      data.endDate,
      data.timezone
    );

    const eventId = uuidv4();
    const organizerToken = generateToken();

    const eventRow = {
      id: eventId,
      title: data.title,
      description: data.description ?? null,
      organizerEmail: data.organizerEmail,
      organizerName: data.organizerName,
      organizerToken,
      startDate: data.startDate,
      endDate: data.endDate,
      dateRangeStart: Math.floor(startMs / 1000),
      dateRangeEnd: Math.floor(endMs / 1000),
      durationMinutes: data.durationMinutes,
      workingHoursStart: data.workingHoursStart,
      workingHoursEnd: data.workingHoursEnd,
      timezone: data.timezone,
      excludeWeekends: data.excludeWeekends,
      weeklyAvailabilityJson: data.weeklyAvailability
        ? JSON.stringify(data.weeklyAvailability)
        : null,
      // The event does not start gathering until the organizer has connected a
      // calendar — otherwise their own availability is missing from the whole
      // calculation.
      status: "draft" as const,
      responseDeadline: data.responseDeadline ?? null,
      nonresponderPolicy: data.nonresponderPolicy,
      idempotencyKey,
      createdByIpHash: hashIdentifier(ip),
    };

    // The organizer is a participant, not a special case bolted on beside one.
    // This is what makes their calendar part of the availability calculation.
    const organizerRow = {
      id: uuidv4(),
      eventId,
      email: data.organizerEmail,
      name: data.organizerName,
      role: "organizer" as const,
      inviteToken: generateToken(),
      status: "pending" as const,
    };

    const attendeeRows = data.participantEmails.map((email) => ({
      id: uuidv4(),
      eventId,
      email,
      role: "attendee" as const,
      inviteToken: generateToken(),
      status: "pending" as const,
    }));

    // One batch, so a half-created event with no participants cannot exist.
    await db.batch([
      db.insert(events).values(eventRow),
      db.insert(participants).values([organizerRow, ...attendeeRows]),
    ]);

    return NextResponse.json(
      {
        eventId,
        organizerToken,
        organizerInviteToken: organizerRow.inviteToken,
        // Invitations are deliberately not sent yet. The next step is the
        // organizer connecting their calendar.
        nextStep: "connect_organizer_calendar",
      },
      { status: 201, headers: rateLimitHeaders(limit.result) }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(zodToApiError(err), { status: 400 });
    }
    console.error("POST /api/events error:", err);
    return NextResponse.json(
      { error: "Something went wrong creating the event." },
      { status: 500 }
    );
  }
}
