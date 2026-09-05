import crypto from "node:crypto";

/**
 * Authenticated encryption for calendar credentials at rest.
 *
 * New ciphertexts use AES-256-GCM and carry a version tag. The previous format
 * was unauthenticated AES-256-CBC, which a database-write attacker could
 * tamper with undetectably; those values still decrypt so existing rows keep
 * working, and every re-save upgrades them.
 *
 * Key rotation: `ENCRYPTION_KEY` encrypts; `ENCRYPTION_KEY_PREVIOUS` is also
 * tried when decrypting, so a rotation can roll forward without downtime.
 */
const GCM_ALGORITHM = "aes-256-gcm";
const LEGACY_CBC_ALGORITHM = "aes-256-cbc";
const VERSION_PREFIX = "v2";
const GCM_IV_BYTES = 12;

export class DecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DecryptionError";
  }
}

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function primarySecret(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY env var is not set");
  return key;
}

/** Primary key first, then any rotation predecessor. */
function candidateKeys(): Buffer[] {
  const keys = [deriveKey(primarySecret())];
  const previous = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (previous) keys.push(deriveKey(previous));
  return keys;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, deriveKey(primarySecret()), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION_PREFIX,
    iv.toString("hex"),
    tag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");

  if (parts[0] === VERSION_PREFIX) {
    const [, ivHex, tagHex, dataHex] = parts;
    // An empty plaintext yields an empty `dataHex`, so test for presence
    // rather than truthiness.
    if (parts.length !== 4 || !ivHex || !tagHex || dataHex === undefined) {
      throw new DecryptionError("Malformed v2 ciphertext");
    }
    let lastError: unknown;
    for (const key of candidateKeys()) {
      try {
        const decipher = crypto.createDecipheriv(
          GCM_ALGORITHM,
          key,
          Buffer.from(ivHex, "hex")
        );
        decipher.setAuthTag(Buffer.from(tagHex, "hex"));
        return Buffer.concat([
          decipher.update(Buffer.from(dataHex, "hex")),
          decipher.final(),
        ]).toString("utf8");
      } catch (error) {
        // A wrong key fails the auth tag; try the rotation predecessor before
        // giving up. Tampering fails every key, which is the point.
        lastError = error;
      }
    }
    throw new DecryptionError("Could not authenticate ciphertext", {
      cause: lastError,
    });
  }

  // Legacy unauthenticated format: `<ivHex>:<ciphertextHex>`.
  if (parts.length === 2) {
    const [ivHex, dataHex] = parts;
    let lastError: unknown;
    for (const key of candidateKeys()) {
      try {
        const decipher = crypto.createDecipheriv(
          LEGACY_CBC_ALGORITHM,
          key,
          Buffer.from(ivHex, "hex")
        );
        return Buffer.concat([
          decipher.update(Buffer.from(dataHex, "hex")),
          decipher.final(),
        ]).toString("utf8");
      } catch (error) {
        lastError = error;
      }
    }
    throw new DecryptionError("Could not decrypt legacy ciphertext", {
      cause: lastError,
    });
  }

  throw new DecryptionError("Unrecognised ciphertext format");
}

/** True when a stored value still uses the unauthenticated legacy format. */
export function needsReencryption(ciphertext: string): boolean {
  return !ciphertext.startsWith(`${VERSION_PREFIX}:`);
}

/** Constant-time comparison for bearer tokens. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/** A URL-safe, high-entropy secret for invite and organizer capabilities. */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Stable pseudonymous identifier for rate limiting, never reversible. */
export function hashIdentifier(value: string): string {
  const salt = process.env.ENCRYPTION_KEY ?? "get2gethr";
  return crypto.createHmac("sha256", salt).update(value).digest("hex").slice(0, 32);
}
