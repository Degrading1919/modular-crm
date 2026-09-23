import { createHash } from "node:crypto";

export function deterministicKey(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.map(String).join("\u001f")).digest("hex");
}
