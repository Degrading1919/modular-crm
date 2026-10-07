import { DEVELOPMENT_AUTH_SECRET } from "@modular-crm/config";

/** Local demos can boot from the example environment; production must supply its own key. */
export function authSigningSecret(): string {
  const configured = process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV === "production" && (!configured || configured.trim() === DEVELOPMENT_AUTH_SECRET || configured.trim().length < 32)) {
    throw new Error("Set a unique BETTER_AUTH_SECRET of at least 32 characters before running in production.");
  }
  return configured ?? DEVELOPMENT_AUTH_SECRET;
}
