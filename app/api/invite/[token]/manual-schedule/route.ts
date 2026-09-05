import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { authorizeInvite, AuthorizationError } from "@/lib/authorization";
import { db, ensureMigrated } from "@/lib/db";
import { participants } from "@/lib/db/schema";
import {
  ManualScheduleValidationError,
  manualScheduleIntervals,
  serializeManualIntervals,
} from "@/lib/manual-schedule";
import {
  clientIdentifier,
  consumeRateLimit,
  INVITE_RESPONSE_PER_IP,
} from "@/lib/rate-limit";
import { advanceEvent } from "@/lib/scheduler";

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

    const audience = await authorizeInvite(token);
    const participant = audience.participant;
    if (!participant) throw new AuthorizationError(404, "Invitation not found");
    if (participant.role === "organizer") {
      return NextResponse.json(
        { error: "The organizer needs a connected calendar for the final meeting." },
        { status: 409 }
      );
    }
    if (participant.status === "declined") {
      return NextResponse.json(
        { error: "You have already declined this invitation." },
        { status: 409 }
      );
    }
    if (!["gathering", "action_required"].includes(audience.event.status)) {
      return NextResponse.json(
        { error: "Availability can no longer be changed for this invitation." },
        { status: 409 }
      );
    }

    const body: unknown = await req.json();
    const blocks =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).blocks
        : undefined;
    const intervals = manualScheduleIntervals({
      blocks,
      eventStartDate: audience.event.startDate,
      eventEndDate: audience.event.endDate,
      timezone: audience.event.timezone,
    });

    const updated = await db
      .update(participants)
      .set({
        availabilityJson: serializeManualIntervals(intervals),
        status: "joined",
        joinedAt: Math.floor(Date.now() / 1000),
      })
      .where(
        and(
          eq(participants.id, participant.id),
          eq(participants.eventId, audience.event.id)
        )
      )
      .returning({ id: participants.id });
    if (updated.length !== 1) throw new AuthorizationError(404, "Invitation not found");

    await advanceEvent(participant.eventId);
    return NextResponse.json({ ok: true, status: "joined" });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ManualScheduleValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
    }
    console.error("POST /api/invite/[token]/manual-schedule error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
