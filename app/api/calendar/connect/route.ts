import { NextRequest, NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/db";
import { AuthorizationError, authorizeInvite } from "@/lib/authorization";
import { startConnection } from "@/lib/calendar-connect";
import type { CalendarProviderId } from "@/lib/calendar";
import type { ClientKind } from "@/lib/oauth-state";
import {
  clientIdentifier,
  consumeRateLimit,
  OAUTH_START_PER_IP,
} from "@/lib/rate-limit";

const PROVIDERS: CalendarProviderId[] = [
  "google",
  "microsoft",
  "apple",
  "exchange",
  "other",
];

/**
 * Starts a calendar connection.
 *
 * Provider-neutral by design: web and iOS both send the person here, and the
 * broker's hosted UI decides which providers to offer. `?json=1` returns the
 * URL instead of redirecting, which is what `ASWebAuthenticationSession` needs.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureMigrated();

    const limit = await consumeRateLimit(OAUTH_START_PER_IP, clientIdentifier(req));
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    }

    const params = req.nextUrl.searchParams;
    const token = params.get("token");
    if (!token) {
      return NextResponse.json(
        { error: "Missing invitation token." },
        { status: 400 }
      );
    }

    const audience = await authorizeInvite(token);
    if (!audience.participant) {
      throw new AuthorizationError(404, "Invitation not found");
    }

    const requested = params.get("provider");
    const provider =
      requested && PROVIDERS.includes(requested as CalendarProviderId)
        ? (requested as CalendarProviderId)
        : undefined;

    const clientKind: ClientKind = params.get("client") === "ios" ? "ios" : "web";

    const started = await startConnection({
      participant: audience.participant,
      provider,
      clientKind,
      returnTo: params.get("returnTo"),
    });

    if (params.get("json") === "1") {
      return NextResponse.json({
        authorizationUrl: started.authorizationUrl,
        broker: started.broker.id,
        providers: started.broker.supportedProviders,
      });
    }

    return NextResponse.redirect(started.authorizationUrl);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("GET /api/calendar/connect error:", error);
    return NextResponse.json(
      { error: "Could not start the calendar connection." },
      { status: 500 }
    );
  }
}
