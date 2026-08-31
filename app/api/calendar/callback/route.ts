import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/db";
import { callbackUrl, handleCallback } from "@/lib/calendar-connect";
import { baseUrl } from "@/lib/email";

/**
 * Completes a calendar connection.
 *
 * The redirect target always comes from the single-use state row, never from a
 * query parameter, so this cannot be turned into an open redirect.
 */
export async function GET(req: NextRequest) {
  await ensureMigrated();

  const params = req.nextUrl.searchParams;
  const outcome = await handleCallback({
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error"),
    // Must match the URI the authorization request used, exactly.
    redirectUri: callbackUrl(),
  });

  const destination = outcome.redirectTo.startsWith("/")
    ? `${baseUrl()}${outcome.redirectTo}`
    : outcome.redirectTo;

  return NextResponse.redirect(destination);
}
