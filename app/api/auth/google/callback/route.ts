import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { participants } from "@/lib/db/schema";
import {
  exchangeCodeForTokens,
  getUserEmail,
} from "@/lib/google-calendar";
import { encrypt } from "@/lib/crypto";
import { checkAndAdvanceEvent } from "@/lib/scheduler";


const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // This is the invite token
  const error = searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(`${BASE_URL}/invite/${state ?? ""}?error=oauth_failed`);
  }

  try {
    const participant = await db.query.participants.findFirst({
      where: eq(participants.inviteToken, state),
    });
    if (!participant) {
      return NextResponse.redirect(`${BASE_URL}/?error=invalid_token`);
    }
    if (participant.status === "joined") {
      // Already joined — redirect to invite page
      return NextResponse.redirect(`${BASE_URL}/invite/${state}?already=joined`);
    }

    const { accessToken, refreshToken } = await exchangeCodeForTokens(code);
    const email = await getUserEmail(accessToken);

    // Update participant record
    await db
      .update(participants)
      .set({
        status: "joined",
        name: email.split("@")[0], // Use email prefix as name if no profile name
        googleAccessToken: encrypt(accessToken),
        googleRefreshToken: encrypt(refreshToken),
        joinedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(participants.inviteToken, state));

    // Trigger event advancement check
    await checkAndAdvanceEvent(participant.eventId);

    return NextResponse.redirect(`${BASE_URL}/invite/${state}?joined=true`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(`${BASE_URL}/invite/${state}?error=server_error`);
  }
}
