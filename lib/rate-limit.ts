import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { rateLimitBuckets } from "./db/schema";
import { hashIdentifier } from "./crypto";

/**
 * Database-backed fixed-window rate limiting.
 *
 * The limiter lives in the database rather than in process memory because the
 * app runs on serverless functions: an in-memory counter would reset on every
 * cold start and be per-instance, which is no limit at all.
 */
export interface RateLimitRule {
  /** Namespace, so two rules never share a counter. */
  name: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Unix seconds when the current window rolls over. */
  resetAt: number;
}

/** Public event creation: the endpoint that can send mail on a stranger's say-so. */
export const EVENT_CREATION_PER_IP: RateLimitRule = {
  name: "events:create:ip",
  limit: 5,
  windowSeconds: 60 * 60,
};

export const EVENT_CREATION_PER_EMAIL: RateLimitRule = {
  name: "events:create:email",
  limit: 10,
  windowSeconds: 24 * 60 * 60,
};

export const EVENT_CREATION_PER_IP_DAILY: RateLimitRule = {
  name: "events:create:ip:daily",
  limit: 20,
  windowSeconds: 24 * 60 * 60,
};

export const OAUTH_START_PER_IP: RateLimitRule = {
  name: "auth:start:ip",
  limit: 30,
  windowSeconds: 60 * 60,
};

export const INVITE_RESPONSE_PER_IP: RateLimitRule = {
  name: "invite:respond:ip",
  limit: 60,
  windowSeconds: 60 * 60,
};

/**
 * Counts one request against a rule.
 *
 * The increment is a single conditional UPDATE followed by an INSERT fallback,
 * so concurrent requests cannot both read "0" and both write "1".
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  identifier: string
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % rule.windowSeconds);
  const id = `${rule.name}:${hashIdentifier(identifier)}`;
  const resetAt = windowStart + rule.windowSeconds;

  const decide = (count: number): RateLimitResult => ({
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    limit: rule.limit,
    resetAt,
  });

  // Bounded retry: losing a race means the row now exists, and the next pass
  // takes the increment path. Returning without incrementing would let an
  // entire concurrent burst through, which is the failure mode this loop
  // exists to prevent.
  for (let attempt = 0; attempt < 5; attempt++) {
    // The row already belongs to this window: increment it in place.
    const bumped = await db
      .update(rateLimitBuckets)
      .set({ count: sql`${rateLimitBuckets.count} + 1` })
      .where(
        and(eq(rateLimitBuckets.id, id), eq(rateLimitBuckets.windowStart, windowStart))
      )
      .returning();
    if (bumped.length === 1) return decide(bumped[0].count);

    // The row belongs to an earlier window: roll it over and count this one.
    const rolled = await db
      .update(rateLimitBuckets)
      .set({ windowStart, count: 1 })
      .where(
        and(eq(rateLimitBuckets.id, id), lt(rateLimitBuckets.windowStart, windowStart))
      )
      .returning();
    if (rolled.length === 1) return decide(1);

    try {
      await db.insert(rateLimitBuckets).values({ id, windowStart, count: 1 });
      return decide(1);
    } catch {
      // Someone else created the row first; loop and increment it instead.
    }
  }

  // Contention never resolved. Refusing is the safe answer for a limiter.
  return { allowed: false, remaining: 0, limit: rule.limit, resetAt };
}

/** Applies several rules; the first refusal wins. */
export async function consumeAll(
  checks: Array<{ rule: RateLimitRule; identifier: string }>
): Promise<{ allowed: boolean; failed?: RateLimitRule; result: RateLimitResult }> {
  let last: RateLimitResult = {
    allowed: true,
    remaining: 0,
    limit: 0,
    resetAt: Math.floor(Date.now() / 1000),
  };
  for (const check of checks) {
    last = await consumeRateLimit(check.rule, check.identifier);
    if (!last.allowed) return { allowed: false, failed: check.rule, result: last };
  }
  return { allowed: true, result: last };
}

/**
 * Best-effort client address.
 *
 * Only the leftmost `x-forwarded-for` entry is used, and only because the app
 * sits behind a proxy that sets it. Values are hashed before storage, so the
 * limiter never keeps a plain IP address.
 */
export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.max(0, result.resetAt - Math.floor(Date.now() / 1000))),
  };
}
