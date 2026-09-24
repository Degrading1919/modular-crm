import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "mcrm-secret:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64url");
  if (key.length !== KEY_BYTES || key.toString("base64url") !== value) {
    throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY must be a base64url-encoded 32-byte key");
  }
  return key;
}

/** Encrypts a secret into a versioned AES-256-GCM envelope safe to store in a database. */
export function sealSecret(plaintext: string, key: string): string {
  if (!plaintext) throw new Error("Secret value is required");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

/** Opens and authenticates a secret envelope. Tampering and wrong keys fail closed. */
export function openSecret(envelope: string, key: string): string {
  if (!envelope.startsWith(PREFIX)) throw new Error("Unsupported secret envelope");
  const parts = envelope.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Invalid secret envelope");
  const [ivEncoded, tagEncoded, ciphertextEncoded] = parts as [string, string, string];
  const iv = Buffer.from(ivEncoded, "base64url");
  const tag = Buffer.from(tagEncoded, "base64url");
  const ciphertext = Buffer.from(ciphertextEncoded, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES
    || iv.toString("base64url") !== ivEncoded || tag.toString("base64url") !== tagEncoded
    || ciphertext.toString("base64url") !== ciphertextEncoded) {
    throw new Error("Invalid secret envelope");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isSecretEnvelope(value: string): boolean {
  return value.startsWith(PREFIX);
}
