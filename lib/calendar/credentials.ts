import { eq } from "drizzle-orm";
import { db } from "../db";
import { calendarConnections, type CalendarConnection } from "../db/schema";
import {
  connectionToGrant,
  getBroker,
  grantToConnectionFields,
  type BrokerId,
  type CalendarGrant,
} from ".";

/**
 * Returns a usable grant and durably stores rotated provider credentials.
 * Direct OAuth providers commonly rotate refresh tokens; losing the latest one
 * turns an otherwise healthy long-lived connection into a future relink.
 */
export async function freshGrantForConnection(
  connection: CalendarConnection
): Promise<CalendarGrant> {
  const broker = getBroker(connection.broker as BrokerId);
  const current = connectionToGrant(connection);
  if (!broker.refreshGrant) return current;

  const fresh = await broker.refreshGrant(current);
  if (
    fresh.accessToken === current.accessToken &&
    fresh.refreshToken === current.refreshToken &&
    fresh.tokenExpiresAt === current.tokenExpiresAt
  ) {
    return fresh;
  }

  const stored = grantToConnectionFields(fresh);
  await db
    .update(calendarConnections)
    .set({
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      tokenExpiresAt: stored.tokenExpiresAt,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(calendarConnections.id, connection.id));
  return fresh;
}
