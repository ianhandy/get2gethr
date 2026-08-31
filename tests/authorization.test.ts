import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { participants, proposedSlots } from "@/lib/db/schema";
import {
  AuthorizationError,
  attendeeEventView,
  authorizeInvite,
  authorizeOrganizer,
  eventViewFor,
  organizerEventView,
  readOrganizerToken,
  requireOrganizer,
} from "@/lib/authorization";
import {
  consumeOAuthState,
  createOAuthState,
  emailsMatch,
  normalizeEmail,
  purgeExpiredStates,
} from "@/lib/oauth-state";
import { safeReturnTo } from "@/lib/calendar-connect";
import { generateToken } from "@/lib/crypto";
import { resetDatabase, seedEvent, setupSchema } from "./helpers/db";

beforeAll(async () => {
  await setupSchema();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("readOrganizerToken", () => {
  it("reads a bearer header", () => {
    const request = new Request("https://get2gethr.test/api/events/1", {
      headers: { authorization: "Bearer abc123" },
    });
    expect(readOrganizerToken(request)).toBe("abc123");
  });

  it("reads the dedicated header", () => {
    const request = new Request("https://get2gethr.test/api/events/1", {
      headers: { "x-organizer-token": "abc123" },
    });
    expect(readOrganizerToken(request)).toBe("abc123");
  });

  it("reads a query parameter, for links people click", () => {
    const request = new Request(
      "https://get2gethr.test/api/events/1?organizerToken=abc123"
    );
    expect(readOrganizerToken(request)).toBe("abc123");
  });

  it("is null when absent", () => {
    expect(readOrganizerToken(new Request("https://get2gethr.test/api/events/1"))).toBe(
      null
    );
  });
});

describe("authorizeOrganizer", () => {
  it("accepts the correct token", async () => {
    const seeded = await seedEvent();
    const audience = await authorizeOrganizer(seeded.event.id, seeded.organizerToken);
    expect(audience.kind).toBe("organizer");
    expect(audience.event.id).toBe(seeded.event.id);
  });

  it("rejects a missing token with 401", async () => {
    const seeded = await seedEvent();
    await expect(authorizeOrganizer(seeded.event.id, null)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects a wrong token as 404, so event ids cannot be probed", async () => {
    const seeded = await seedEvent();
    await expect(
      authorizeOrganizer(seeded.event.id, generateToken())
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reports a nonexistent event identically to a wrong token", async () => {
    const capture = async (eventId: string): Promise<AuthorizationError> => {
      try {
        await authorizeOrganizer(eventId, generateToken());
      } catch (error) {
        return error as AuthorizationError;
      }
      throw new Error("expected authorization to fail");
    };

    const missing = await capture("00000000-0000-4000-8000-000000000000");
    const seeded = await seedEvent();
    const wrong = await capture(seeded.event.id);

    expect(missing.status).toBe(wrong.status);
    expect(missing.message).toBe(wrong.message);
  });

  it("refuses one event's organizer token on another event", async () => {
    const first = await seedEvent({ organizerEmail: "a@example.com" });
    const second = await seedEvent({ organizerEmail: "b@example.com" });
    await expect(
      authorizeOrganizer(second.event.id, first.organizerToken)
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an invite token used as an organizer token", async () => {
    const seeded = await seedEvent();
    await expect(
      authorizeOrganizer(seeded.event.id, seeded.attendees[0].inviteToken)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("authorizeInvite", () => {
  it("resolves an attendee from their own token", async () => {
    const seeded = await seedEvent();
    const audience = await authorizeInvite(seeded.attendees[0].inviteToken);
    expect(audience.kind).toBe("attendee");
    expect(audience.participant!.id).toBe(seeded.attendees[0].id);
  });

  it("treats the organizer's own invite token as organizer access", async () => {
    const seeded = await seedEvent();
    const audience = await authorizeInvite(seeded.organizer.inviteToken);
    expect(audience.kind).toBe("organizer");
  });

  it("rejects an unknown token", async () => {
    await expect(authorizeInvite(generateToken())).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects a removed participant's token", async () => {
    const seeded = await seedEvent();
    await db
      .update(participants)
      .set({ status: "removed" })
      .where(eq(participants.id, seeded.attendees[0].id));

    await expect(
      authorizeInvite(seeded.attendees[0].inviteToken)
    ).rejects.toMatchObject({ status: 404 });
  });

  it("scopes a token to exactly one event", async () => {
    const first = await seedEvent();
    const second = await seedEvent({ organizerEmail: "other@example.com" });
    const audience = await authorizeInvite(first.attendees[0].inviteToken);
    expect(audience.event.id).toBe(first.event.id);
    expect(audience.event.id).not.toBe(second.event.id);
  });
});

describe("requireOrganizer", () => {
  it("passes an organizer through", async () => {
    const seeded = await seedEvent();
    const audience = await authorizeOrganizer(seeded.event.id, seeded.organizerToken);
    expect(requireOrganizer(audience).id).toBe(seeded.event.id);
  });

  it("refuses an attendee with 403", async () => {
    const seeded = await seedEvent();
    const audience = await authorizeInvite(seeded.attendees[0].inviteToken);
    expect(() => requireOrganizer(audience)).toThrow(AuthorizationError);
  });
});

describe("audience-scoped views", () => {
  async function viewInput() {
    const seeded = await seedEvent();
    return {
      seeded,
      input: {
        event: seeded.event,
        participants: [seeded.organizer, ...seeded.attendees],
        connections: new Map(),
        currentSlot: null,
        confirmedSlot: null,
      },
    };
  }

  it("gives the organizer every participant address", async () => {
    const { seeded, input } = await viewInput();
    const view = organizerEventView(input);
    const emails = view.participants.map((p) => p.email);
    expect(emails).toContain(seeded.attendees[0].email);
    expect(emails).toContain(seeded.attendees[1].email);
    expect(view.event.organizerEmail).toBe(seeded.event.organizerEmail);
  });

  it("never gives an attendee the other attendees' addresses", async () => {
    const { seeded, input } = await viewInput();
    const view = attendeeEventView(input, seeded.attendees[0]);
    const serialized = JSON.stringify(view);

    expect(serialized).toContain(seeded.attendees[0].email); // their own
    expect(serialized).not.toContain(seeded.attendees[1].email);
  });

  it("does not leak the organizer's address to an attendee", async () => {
    const { seeded, input } = await viewInput();
    const view = attendeeEventView(input, seeded.attendees[0]);
    expect(JSON.stringify(view)).not.toContain(seeded.event.organizerEmail);
    // The organizer's name is still shown, so the invitation makes sense.
    expect(view.event.organizerName).toBe(seeded.event.organizerName);
  });

  it("shows an attendee progress as counts, not identities", async () => {
    const { seeded, input } = await viewInput();
    const view = attendeeEventView(input, seeded.attendees[0]);
    expect(view.others).toEqual({ total: 2, joined: 0, declined: 0, pending: 2 });
  });

  it("never exposes invite tokens or organizer tokens in any view", async () => {
    const { seeded, input } = await viewInput();
    for (const view of [
      organizerEventView(input),
      attendeeEventView(input, seeded.attendees[0]),
    ]) {
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain(seeded.organizerToken);
      expect(serialized).not.toContain(seeded.attendees[0].inviteToken);
      expect(serialized).not.toContain(seeded.organizer.inviteToken);
    }
  });

  it("carries the organizer's own connection status, so their invite page updates", async () => {
    const { seeded, input } = await viewInput();
    const view = organizerEventView(input, seeded.organizer);
    expect(view.viewer.id).toBe(seeded.organizer.id);
    expect(view.viewer.email).toBe(seeded.organizer.email);
    expect(view.viewer.status).toBe("pending");
    expect(view.viewer.connection).toBeNull();
  });

  it("falls back to the organizer row when no viewer is supplied", async () => {
    const { seeded, input } = await viewInput();
    expect(organizerEventView(input).viewer.id).toBe(seeded.organizer.id);
  });

  it("dispatches on the audience", async () => {
    const { seeded, input } = await viewInput();
    const organizer = await authorizeOrganizer(seeded.event.id, seeded.organizerToken);
    const attendee = await authorizeInvite(seeded.attendees[0].inviteToken);

    expect(eventViewFor(organizer, input).viewer.role).toBe("organizer");
    expect(eventViewFor(attendee, input).viewer.role).toBe("attendee");
  });
});

describe("OAuth state", () => {
  it("issues a single-use nonce that is not the invite token", async () => {
    const seeded = await seedEvent();
    const { state } = await createOAuthState({
      participantId: seeded.attendees[0].id,
      eventId: seeded.event.id,
      provider: "google",
      returnTo: "/invite/abc",
    });
    expect(state).not.toBe(seeded.attendees[0].inviteToken);
    expect(state.length).toBeGreaterThanOrEqual(43);
  });

  it("consumes successfully exactly once", async () => {
    const seeded = await seedEvent();
    const { state } = await createOAuthState({
      participantId: seeded.attendees[0].id,
      eventId: seeded.event.id,
      provider: "google",
      returnTo: "/invite/abc",
    });

    const first = await consumeOAuthState(state);
    expect(first.ok).toBe(true);

    const replay = await consumeOAuthState(state);
    expect(replay).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects an unknown state", async () => {
    expect(await consumeOAuthState(generateToken())).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("rejects an expired state", async () => {
    const seeded = await seedEvent();
    const { state } = await createOAuthState({
      participantId: seeded.attendees[0].id,
      eventId: seeded.event.id,
      provider: "google",
      returnTo: "/invite/abc",
      ttlSeconds: -10,
    });
    expect(await consumeOAuthState(state)).toEqual({ ok: false, reason: "expired" });
  });

  it("carries the return destination and client kind", async () => {
    const seeded = await seedEvent();
    const { state } = await createOAuthState({
      participantId: seeded.attendees[0].id,
      eventId: seeded.event.id,
      provider: "google",
      returnTo: "/invite/abc",
      clientKind: "ios",
    });
    const consumed = await consumeOAuthState(state);
    expect(consumed.ok && consumed.state.returnTo).toBe("/invite/abc");
    expect(consumed.ok && consumed.state.clientKind).toBe("ios");
  });

  it("survives concurrent consumption with exactly one winner", async () => {
    const seeded = await seedEvent();
    const { state } = await createOAuthState({
      participantId: seeded.attendees[0].id,
      eventId: seeded.event.id,
      provider: "google",
      returnTo: "/invite/abc",
    });

    const results = await Promise.all([
      consumeOAuthState(state),
      consumeOAuthState(state),
      consumeOAuthState(state),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("purges states that expired long ago", async () => {
    const seeded = await seedEvent();
    await createOAuthState({
      participantId: seeded.attendees[0].id,
      eventId: seeded.event.id,
      provider: "google",
      returnTo: "/invite/abc",
      ttlSeconds: -100_000,
    });
    await purgeExpiredStates();
    const remaining = await db.query.oauthStates.findMany({});
    expect(remaining).toHaveLength(0);
  });
});

describe("identity matching", () => {
  it("matches the same address in any case", () => {
    expect(emailsMatch("Alex@Example.com", "alex@example.com")).toBe(true);
  });

  it("matches a plus-tagged address", () => {
    expect(emailsMatch("alex@example.com", "alex+work@example.com")).toBe(true);
  });

  it("ignores dots only for Gmail, where they are not significant", () => {
    expect(emailsMatch("alex.smith@gmail.com", "alexsmith@gmail.com")).toBe(true);
    expect(emailsMatch("alex.smith@example.com", "alexsmith@example.com")).toBe(false);
  });

  it("refuses a different person", () => {
    expect(emailsMatch("alex@example.com", "mallory@example.com")).toBe(false);
    expect(emailsMatch("alex@example.com", "alex@evil.com")).toBe(false);
  });

  it("normalizes predictably", () => {
    expect(normalizeEmail("  Alex+Tag@GMail.com ")).toBe("alex@gmail.com");
  });
});

describe("safeReturnTo", () => {
  it("allows relative paths", () => {
    expect(safeReturnTo("/invite/abc", "/")).toBe("/invite/abc");
  });

  it("allows our own origin", () => {
    expect(safeReturnTo("https://get2gethr.test/events/1", "/")).toBe(
      "https://get2gethr.test/events/1"
    );
  });

  it("allows the iOS app scheme", () => {
    expect(safeReturnTo("get2gethr://invite/abc", "/")).toBe("get2gethr://invite/abc");
  });

  it("refuses another origin", () => {
    expect(safeReturnTo("https://evil.example.com/steal", "/fallback")).toBe(
      "/fallback"
    );
  });

  it("refuses a protocol-relative URL", () => {
    expect(safeReturnTo("//evil.example.com", "/fallback")).toBe("/fallback");
  });

  it("refuses a javascript URL", () => {
    expect(safeReturnTo("javascript:alert(1)", "/fallback")).toBe("/fallback");
  });

  it("falls back when nothing is supplied", () => {
    expect(safeReturnTo(null, "/fallback")).toBe("/fallback");
  });
});

describe("slot data never leaks other events", () => {
  it("keeps slots scoped to their own event", async () => {
    const first = await seedEvent();
    const second = await seedEvent({ organizerEmail: "other@example.com" });

    await db.insert(proposedSlots).values({
      id: "11111111-1111-4111-8111-111111111111",
      eventId: first.event.id,
      rank: 0,
      startTime: 1,
      endTime: 2,
      status: "proposed",
    });

    const forSecond = await db.query.proposedSlots.findMany({
      where: eq(proposedSlots.eventId, second.event.id),
    });
    expect(forSecond).toHaveLength(0);
  });
});
