import { createHash } from "node:crypto";
import { resetRateLimit } from "@modular-crm/db";
import { getDb } from "../db";
import { clientIpKey, limitKey } from "./rate-limits";

export function authBudgetKeys(request: Request, email: string, action: "signin" | "reset") {
  const normalized = email.trim().toLowerCase();
  const account = createHash("sha256").update(normalized).digest("hex");
  const pair = createHash("sha256").update(`${normalized}\0${clientIpKey(request).slice(0, 24)}`).digest("hex");
  return { account: `auth:account:${action}:${account}`, pair: `auth:${action === "signin" ? "credential" : "reset"}:${pair}` };
}
export async function limitAuthAccount(request: Request, email: string, action: "signin" | "reset") {
  const keys = authBudgetKeys(request, email, action);
  const limited = await limitKey(keys.account, 10, 900_000) ?? await limitKey(keys.pair, 5, 600_000);
  return { keys, limited };
}
export async function resetSignInBudget(keys: ReturnType<typeof authBudgetKeys>): Promise<void> {
  // Never reset the shared address budget or another account's counters.
  await resetRateLimit(getDb(), keys.account);
  await resetRateLimit(getDb(), keys.pair);
}
