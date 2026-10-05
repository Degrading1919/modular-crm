import { hkdfSync } from "node:crypto";
import { sealSecret, openSecret } from "@modular-crm/domain";

function key(secret: string) {
  return Buffer.from(hkdfSync("sha256", secret, "modular-crm", "account-email-outbox-v1", 32)).toString("base64url");
}
/** Do not expose password/activation links through normal message history or data exports. */
export function sealAccountEmail(body: string, secret: string): string { return sealSecret(body, key(secret)); }
export function openAccountEmail(body: string, secret: string): string { return openSecret(body, key(secret)); }
