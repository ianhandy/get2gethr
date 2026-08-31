import type { CalendarConnection } from "../db/schema";
import { decrypt, encrypt } from "../crypto";
import { CronofyBroker } from "./cronofy";
import { FakeCalendarBroker } from "./fake";
import { GoogleCalendarBroker } from "./google";
import type { BrokerId, CalendarBroker, CalendarGrant } from "./types";

export * from "./types";
export { GoogleCalendarBroker } from "./google";
export { CronofyBroker } from "./cronofy";
export { FakeCalendarBroker } from "./fake";

const registry = new Map<BrokerId, CalendarBroker>();

/**
 * Replaces a broker for the duration of a test. Returns a restore function.
 * Nothing in production calls this.
 */
export function __setBrokerForTesting(
  id: BrokerId,
  broker: CalendarBroker | null
): () => void {
  const previous = registry.get(id);
  if (broker) registry.set(id, broker);
  else registry.delete(id);
  return () => {
    if (previous) registry.set(id, previous);
    else registry.delete(id);
  };
}

export function getBroker(id: BrokerId): CalendarBroker {
  const existing = registry.get(id);
  if (existing) return existing;

  const broker: CalendarBroker =
    id === "cronofy"
      ? new CronofyBroker()
      : id === "fake"
        ? new FakeCalendarBroker()
        : new GoogleCalendarBroker();
  registry.set(id, broker);
  return broker;
}

/**
 * The broker new connections should use.
 *
 * Cronofy wins when it is configured, because it is the only option that lets a
 * Microsoft or Apple user join at all. Direct Google remains the fallback so a
 * deployment without a broker contract still works for Google accounts rather
 * than failing shut.
 */
export class CalendarNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarNotConfiguredError";
  }
}

export function getActiveBroker(): CalendarBroker {
  const preferred = process.env.CALENDAR_BROKER as BrokerId | undefined;
  if (preferred) {
    const broker = getBroker(preferred);
    if (!broker.isConfigured()) {
      throw new CalendarNotConfiguredError(
        `CALENDAR_BROKER is set to "${preferred}" but its credentials are missing`
      );
    }
    return broker;
  }

  const cronofy = getBroker("cronofy");
  if (cronofy.isConfigured()) return cronofy;

  const google = getBroker("google");
  if (google.isConfigured()) return google;

  // Sending someone to an authorization URL built from missing credentials
  // produces a provider error page with an empty client_id. Refusing here
  // turns a confusing dead end into an operator-visible misconfiguration.
  throw new CalendarNotConfiguredError(
    "No calendar provider is configured. Set CRONOFY_CLIENT_ID/SECRET, or GOOGLE_CLIENT_ID/SECRET."
  );
}

/** Every provider a person could connect on this deployment, for the UI. */
export function supportedProviders(): string[] {
  return [...getActiveBroker().supportedProviders];
}

/** Reads a stored connection row into the grant shape brokers accept. */
export function connectionToGrant(connection: CalendarConnection): CalendarGrant {
  return {
    broker: connection.broker as BrokerId,
    provider: connection.provider as CalendarGrant["provider"],
    accountEmail: connection.accountEmail,
    brokerProfileId: connection.brokerProfileId,
    brokerAccountId: connection.brokerAccountId,
    sourceCalendarIds: parseCalendarIds(connection.sourceCalendarIds),
    destinationCalendarId: connection.destinationCalendarId,
    accessToken: connection.accessToken ? decrypt(connection.accessToken) : null,
    refreshToken: connection.refreshToken ? decrypt(connection.refreshToken) : null,
    tokenExpiresAt: connection.tokenExpiresAt,
  };
}

/** Encrypts the credential fields of a grant for storage. */
export function grantToConnectionFields(grant: CalendarGrant) {
  return {
    provider: grant.provider,
    broker: grant.broker,
    accountEmail: grant.accountEmail,
    brokerProfileId: grant.brokerProfileId,
    brokerAccountId: grant.brokerAccountId,
    sourceCalendarIds: JSON.stringify(grant.sourceCalendarIds),
    destinationCalendarId: grant.destinationCalendarId,
    accessToken: grant.accessToken ? encrypt(grant.accessToken) : null,
    refreshToken: grant.refreshToken ? encrypt(grant.refreshToken) : null,
    tokenExpiresAt: grant.tokenExpiresAt,
  };
}

function parseCalendarIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}
