import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const SERVICE_ACCESS_KEY_PURPOSE = "modular-crm:service-access:v1";
const DEVELOPMENT_AUTH_SECRET = "dev-only-replace-before-deploying-0123456789";

function serviceAccessKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET;
  return createHash("sha256").update(secret).update(SERVICE_ACCESS_KEY_PURPOSE).digest();
}

/** Encrypts customer access instructions using the established v1 AES-256-GCM envelope. */
export function encryptServiceAccessInstructions(value: string): string | null {
  const clear = value.trim();
  if (!clear) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", serviceAccessKey(), iv);
  const encrypted = Buffer.concat([cipher.update(clear, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

/** Returns null for legacy, malformed, or unauthenticated values; ciphertext is never exposed as plaintext. */
export function decryptServiceAccessInstructions(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^v1:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) return null;

  try {
    const iv = Buffer.from(match[1]!, "base64url");
    const tag = Buffer.from(match[2]!, "base64url");
    const ciphertext = Buffer.from(match[3]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) return null;
    const decipher = createDecipheriv("aes-256-gcm", serviceAccessKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
