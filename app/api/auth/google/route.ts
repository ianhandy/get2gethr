import { NextRequest, NextResponse } from "next/server";
import { baseUrl } from "@/lib/email";

/**
 * Legacy entry point, kept so older links and app builds keep working.
 * Calendar connection is provider-neutral now; this just forwards.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing invitation token." }, { status: 400 });
  }

  const target = new URL("/api/calendar/connect", baseUrl());
  target.searchParams.set("token", token);
  const provider = req.nextUrl.searchParams.get("provider");
  if (provider) target.searchParams.set("provider", provider);

  return NextResponse.redirect(target.toString());
}
