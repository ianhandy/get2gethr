import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureMigrated } from "@/lib/db";
import { participants } from "@/lib/db/schema";
import { AuthorizationError, authorizeInvite } from "@/lib/authorization";
import { advanceEvent } from "@/lib/scheduler";
import {
  clientIdentifier,
  consumeRateLimit,
  INVITE_RESPONSE_PER_IP,
} from "@/lib/rate-limit";

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
        { error: "The organizer cannot decline their own event; cancel it instead." },
        { status: 409 }
      );
    }

    // Conditional so a double-click, or a retry after a timeout, is a no-op
    // rather than an error the person has to interpret.
    const declined = await db
      .update(participants)
      .set({ status: "declined" })
      .where(
        and(eq(participants.id, participant.id), eq(participants.status, "pending"))
      )
      .returning();

    if (declined.length === 0 && participant.status !== "declined") {
      return NextResponse.json(
        { error: "You have already responded to this invitation." },
        { status: 409 }
      );
    }

    // Always re-run: if a previous attempt died after the status change but
    // before advancing, this is what unsticks the event.
    await advanceEvent(participant.eventId);

    return NextResponse.json({ ok: true, status: "declined" });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("POST /api/invite/[token]/decline error:", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
