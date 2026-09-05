import { NextResponse } from "next/server";
import { client } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A deliberately small readiness check suitable for an external uptime probe. */
export async function GET() {
  try {
    await client.execute("SELECT 1");
    return NextResponse.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
