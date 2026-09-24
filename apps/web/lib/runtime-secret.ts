const DEVELOPMENT_SECRET = "dev-only-replace-before-deploying-0123456789";

/** Local demos can boot from the example environment; production must supply its own key. */
export function authSigningSecret(): string {
  const configured = process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV === "production" && (!configured || configured === DEVELOPMENT_SECRET || configured.length < 32)) {
    throw new Error("Set a unique BETTER_AUTH_SECRET of at least 32 characters before running in production.");
  }
  return configured ?? DEVELOPMENT_SECRET;
}
