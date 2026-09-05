import type { CalendarConnection } from "../db/schema";
import { decrypt, encrypt } from "../crypto";
import { CronofyBroker } from "./cronofy";
import { FakeCalendarBroker } from "./fake";
import { GoogleCalendarBroker } from "./google";
import { MicrosoftCalendarBroker } from "./microsoft";
import type {
  BrokerId,
  CalendarBroker,
  CalendarGrant,
  CalendarProviderId,
} from "./types";

export * from "./types";
export { GoogleCalendarBroker } from "./google";
export { MicrosoftCalendarBroker } from "./microsoft";
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

  let broker: CalendarBroker;
  switch (id) {
    case "cronofy":
      broker = new CronofyBroker();
      break;
    case "fake":
      broker = new FakeCalendarBroker();
      break;
    case "microsoft":
      broker = new MicrosoftCalendarBroker();
      break;
    case "google":
      broker = new GoogleCalendarBroker();
      break;
  }
  registry.set(id, broker);
  return broker;
}

/**
 * The broker new connections should use.
 *
 * An explicit deployment-wide broker still wins. Without one, a user's chosen
 * provider selects its direct adapter first and only falls back to Cronofy when
 * a direct adapter is unavailable. This keeps routine OAuth upkeep in-house
 * while preserving an optional route for Apple and Exchange.
 */
export class CalendarNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarNotConfiguredError";
  }
}

export function getActiveBroker(
  preferredProvider?: CalendarProviderId
): CalendarBroker {
  const preferred = process.env.CALENDAR_BROKER as BrokerId | undefined;
  if (preferred) {
    const broker = getBroker(preferred);
    if (!broker.isConfigured()) {
      throw new CalendarNotConfiguredError(
        `CALENDAR_BROKER is set to "${preferred}" but its credentials are missing`
      );
    }
    if (
      preferredProvider &&
      preferredProvider !== "other" &&
      !broker.supportedProviders.includes(preferredProvider)
    ) {
      throw new CalendarNotConfiguredError(
        `${broker.displayName} does not support ${preferredProvider} calendars`
      );
    }
    return broker;
  }

  if (preferredProvider === "google") {
    const google = getBroker("google");
    if (google.isConfigured()) return google;
  }

  if (preferredProvider === "microsoft") {
    const microsoft = getBroker("microsoft");
    if (microsoft.isConfigured()) return microsoft;
  }

  const cronofy = getBroker("cronofy");
  if (
    cronofy.isConfigured() &&
    (!preferredProvider ||
      preferredProvider === "other" ||
      cronofy.supportedProviders.includes(preferredProvider))
  ) {
    return cronofy;
  }

  const google = getBroker("google");
  if (!preferredProvider && google.isConfigured()) return google;

  const microsoft = getBroker("microsoft");
  if (!preferredProvider && microsoft.isConfigured()) return microsoft;

  // Sending someone to an authorization URL built from missing credentials
  // produces a provider error page with an empty client_id. Refusing here
  // turns a confusing dead end into an operator-visible misconfiguration.
  throw new CalendarNotConfiguredError(
    preferredProvider
      ? `No configured calendar route supports ${preferredProvider}`
      : "No calendar provider is configured. Set Google, Microsoft, or Cronofy credentials."
  );
}

/** Every provider a person could connect on this deployment, for the UI. */
export function supportedProviders(): CalendarProviderId[] {
  const explicit = process.env.CALENDAR_BROKER as BrokerId | undefined;
  if (explicit) return [...getActiveBroker().supportedProviders];

  const providers = new Set<CalendarProviderId>();
  for (const id of ["google", "microsoft", "cronofy"] as const) {
    const broker = getBroker(id);
    if (!broker.isConfigured()) continue;
    for (const provider of broker.supportedProviders) providers.add(provider);
  }
  if (providers.size === 0) getActiveBroker();
  return [...providers];
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
