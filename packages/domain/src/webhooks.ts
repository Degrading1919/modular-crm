import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError } from "./errors.ts";

export function createApiKey(): { plain: string; hash: string; prefix: string } {
  const plain = `mcrm_${randomBytes(32).toString("base64url")}`;
  return { plain, hash: hashApiKey(plain), prefix: plain.slice(0, 12) };
}

export function hashApiKey(key: string): string { return createHash("sha256").update(key).digest("hex"); }

export function verifyApiKey(key: string, expectedHash: string): boolean {
  const left = Buffer.from(hashApiKey(key), "hex");
  const right = Buffer.from(expectedHash, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signWebhook(secret: string, timestampSeconds: number, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex")}`;
}

export function verifyWebhook(secret: string, timestampSeconds: number, rawBody: string, signature: string, nowSeconds = Math.floor(Date.now() / 1000)): void {
  if (Math.abs(nowSeconds - timestampSeconds) > 300) throw new DomainError("FORBIDDEN", "Webhook timestamp is outside the accepted window.", 403);
  const expected = Buffer.from(signWebhook(secret, timestampSeconds, rawBody));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new DomainError("FORBIDDEN", "Webhook signature is invalid.", 403);
}
