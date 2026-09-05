import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/db";
import { handleCallback, legacyGoogleCallbackUrl } from "@/lib/calendar-connect";
import { baseUrl } from "@/lib/email";

/**
 * Legacy Google callback.
 *
 * This path is already registered as an authorized redirect URI in the Google
 * Cloud console, so it keeps working rather than requiring a console change to
 * deploy. New brokers register `/api/calendar/callback`; both funnel into the
 * same provider-neutral handler.
 */
export async function GET(req: NextRequest) {
  await ensureMigrated();

  const params = req.nextUrl.searchParams;
  const outcome = await handleCallback({
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error"),
    redirectUri: legacyGoogleCallbackUrl(),
  });

  const destination = outcome.redirectTo.startsWith("/")
    ? `${baseUrl()}${outcome.redirectTo}`
    : outcome.redirectTo;

  return NextResponse.redirect(destination);
}
