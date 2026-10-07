import { clientIpKey, limitKey } from "./rate-limits";
import { json } from "./http";
import { limitAuthAccount, resetSignInBudget, type authBudgetKeys } from "./auth-budgets";

/** Better Auth's direct HTTP routes and V1 calls must share the same guessing budget. */
export async function handleAuthHttp(request: Request, handler: (request: Request) => Promise<Response>): Promise<Response> {
  const ip = clientIpKey(request).slice(0, 24);
  const limited = await limitKey(`auth:ip:${ip}`, 300, 600_000);
  if (limited) return limited;
  const pathname = new URL(request.url).pathname;
  const signIn = pathname.endsWith("/sign-in/email");
  const reset = pathname.endsWith("/request-password-reset") || pathname.endsWith("/reset-password");
  const category = signIn ? "signin" : reset ? "reset" : pathname.endsWith("/sign-up/email") ? "signup" : "other";
  if (!signIn) {
    const limitedAction = await limitKey(`auth.http:${category}:${ip}`, 30, 60_000);
    if (limitedAction) return limitedAction;
  }
  let keys: ReturnType<typeof authBudgetKeys> | undefined;
  if (signIn || reset) {
    const reader = request.clone().body?.getReader();
    if (reader) {
      let bytes = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 64 * 1024) { void reader.cancel().catch(() => undefined); return json({ error: { code: "VALIDATION_ERROR", message: "This request is too large." } }, 413); }
        chunks.push(value);
      }
      let email: unknown;
      try { email = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { email?: unknown })?.email; }
      catch { /* Better Auth returns its own validation response. */ }
      if (typeof email === "string" && email.length <= 254) {
        const budget = await limitAuthAccount(request, email, signIn ? "signin" : "reset");
        keys = budget.keys;
        if (budget.limited) return budget.limited;
      }
    }
  }
  const response = await handler(request);
  if (signIn && response.ok && keys) await resetSignInBudget(keys);
  return response;
}
