import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DecryptionError,
  decrypt,
  encrypt,
  generateToken,
  hashIdentifier,
  needsReencryption,
  safeEqual,
} from "@/lib/crypto";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "test-encryption-key";
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** Produces a value in the old unauthenticated CBC format. */
function legacyEncrypt(plaintext: string, secret: string): string {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${data.toString("hex")}`;
}

describe("encrypt / decrypt", () => {
  it("round-trips a value", () => {
    expect(decrypt(encrypt("refresh-token-value"))).toBe("refresh-token-value");
  });

  it("round-trips unicode and empty strings", () => {
    expect(decrypt(encrypt(""))).toBe("");
    expect(decrypt(encrypt("café ☕ 日本"))).toBe("café ☕ 日本");
  });

  it("produces a different ciphertext each time", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("tags new ciphertexts with a version", () => {
    expect(encrypt("value").startsWith("v2:")).toBe(true);
  });

  it("refuses a value encrypted under a different key", () => {
    const ciphertext = encrypt("secret");
    process.env.ENCRYPTION_KEY = "a-completely-different-key";
    expect(() => decrypt(ciphertext)).toThrow(DecryptionError);
  });

  it("detects tampering instead of returning garbage", () => {
    const ciphertext = encrypt("balance=100");
    const [version, iv, tag, data] = ciphertext.split(":");
    const flipped = (parseInt(data.slice(0, 2), 16) ^ 0xff)
      .toString(16)
      .padStart(2, "0");
    const tampered = [version, iv, tag, flipped + data.slice(2)].join(":");
    expect(() => decrypt(tampered)).toThrow(DecryptionError);
  });

  it("detects a swapped authentication tag", () => {
    const a = encrypt("value-a");
    const b = encrypt("value-b");
    const [, ivA, , dataA] = a.split(":");
    const [, , tagB] = b.split(":");
    expect(() => decrypt(["v2", ivA, tagB, dataA].join(":"))).toThrow(DecryptionError);
  });

  it("rejects an unrecognised format", () => {
    expect(() => decrypt("not-a-ciphertext")).toThrow(DecryptionError);
    expect(() => decrypt("v2:only:three")).toThrow(DecryptionError);
  });
});

describe("key rotation", () => {
  it("decrypts values written under the previous key", () => {
    const ciphertext = encrypt("rotate-me");
    process.env.ENCRYPTION_KEY_PREVIOUS = "test-encryption-key";
    process.env.ENCRYPTION_KEY = "the-new-key";
    expect(decrypt(ciphertext)).toBe("rotate-me");
  });

  it("encrypts new values under the current key only", () => {
    process.env.ENCRYPTION_KEY_PREVIOUS = "old-key";
    process.env.ENCRYPTION_KEY = "new-key";
    const ciphertext = encrypt("fresh");
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    expect(decrypt(ciphertext)).toBe("fresh");
  });
});

describe("legacy CBC compatibility", () => {
  it("still reads values written by the old scheme", () => {
    const legacy = legacyEncrypt("old-google-token", "test-encryption-key");
    expect(decrypt(legacy)).toBe("old-google-token");
  });

  it("flags legacy values as needing re-encryption", () => {
    expect(needsReencryption(legacyEncrypt("x", "test-encryption-key"))).toBe(true);
    expect(needsReencryption(encrypt("x"))).toBe(false);
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("token-abc", "token-abc")).toBe(true);
  });

  it("rejects different strings and different lengths", () => {
    expect(safeEqual("token-abc", "token-abd")).toBe(false);
    expect(safeEqual("short", "considerably-longer")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});

describe("generateToken", () => {
  it("produces URL-safe, unguessable values", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
  });
});

describe("hashIdentifier", () => {
  it("is stable for the same input", () => {
    expect(hashIdentifier("203.0.113.7")).toBe(hashIdentifier("203.0.113.7"));
  });

  it("differs across inputs and never echoes the input", () => {
    const hashed = hashIdentifier("203.0.113.7");
    expect(hashed).not.toBe(hashIdentifier("203.0.113.8"));
    expect(hashed).not.toContain("203.0.113");
  });
});
