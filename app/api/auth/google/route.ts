import { NextRequest, NextResponse } from "next/server";
import { getAuthorizationUrl } from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const inviteToken = searchParams.get("token");
  if (!inviteToken) {
    return NextResponse.json({ error: "Missing invite token" }, { status: 400 });
  }

  const url = getAuthorizationUrl(inviteToken);
  return NextResponse.redirect(url);
}
