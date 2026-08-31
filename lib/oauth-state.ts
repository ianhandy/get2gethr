import crypto from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "./db";
import { oauthStates, type OAuthState } from "./db/schema";
import { generateToken } from "./crypto";

/**
 * Short-lived, single-use OAuth state.
 *
 * The invite token must never be used as OAuth state: it is a long-lived
 * bearer capability that travels in emails, so anyone holding a forwarded
 * invite could complete an authorization and attach their own calendar to
 * someone else's participant record. State here is a fresh nonce, bound to one
 * participant and one return destination, valid for minutes, and consumed
 * atomically on first use so a replayed callback fails.
 */
export const STATE_TTL_SECONDS = 15 * 60;

export type ClientKind = "web" | "ios";

export interface CreateStateInput {
  participantId: string;
  eventId: string;
  provider: string;
  returnTo: string;
  clientKind?: ClientKind;
  codeVerifier?: string;
  ttlSeconds?: number;
}

export async function createOAuthState(
  input: CreateStateInput
): Promise<{ state: string; expiresAt: number }> {
  const state = generateToken(32);
  const expiresAt =
    Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? STATE_TTL_SECONDS);

  await db.insert(oauthStates).values({
    id: state,
    participantId: input.participantId,
    eventId: input.eventId,
    provider: input.provider,
    codeVerifier: input.codeVerifier ?? null,
    returnTo: input.returnTo,
    clientKind: input.clientKind ?? "web",
    expiresAt,
  });

  return { state, expiresAt };
}

export type ConsumeResult =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "unknown" | "expired" | "already_used" };

/**
 * Atomically consumes a state value.
 *
 * The `consumed_at IS NULL` guard is inside the UPDATE, so two concurrent
 * callbacks race in the database and exactly one wins. A prior read-then-write
 * would let both through.
 */
export async function consumeOAuthState(state: string): Promise<ConsumeResult> {
  const now = Math.floor(Date.now() / 1000);

  const updated = await db
    .update(oauthStates)
    .set({ consumedAt: now })
    .where(and(eq(oauthStates.id, state), isNull(oauthStates.consumedAt)))
    .returning();

  if (updated.length === 1) {
    const row = updated[0];
    if (row.expiresAt < now) return { ok: false, reason: "expired" };
    return { ok: true, state: row };
  }

  const existing = await db.query.oauthStates.findFirst({
    where: eq(oauthStates.id, state),
  });
  if (!existing) return { ok: false, reason: "unknown" };
  return { ok: false, reason: "already_used" };
}

/** Drops states that expired more than a day ago. */
export async function purgeExpiredStates(olderThanSeconds = 86_400): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - olderThanSeconds;
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, cutoff));
}

/**
 * Whether a connected account may be attached to this invitation.
 *
 * Comparison is case-insensitive and ignores Gmail-style dots and `+tags`, so
 * `Alex.Smith+work@gmail.com` still matches an invitation sent to
 * `alexsmith@gmail.com`. Anything else is a mismatch the user must resolve by
 * signing in with the right account.
 */
export function emailsMatch(invited: string, connected: string): boolean {
  return normalizeEmail(invited) === normalizeEmail(connected);
}

export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return trimmed;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

/** A PKCE verifier/challenge pair for brokers that support it. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}
