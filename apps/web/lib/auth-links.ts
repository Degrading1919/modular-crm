/** Map Better Auth's API reset URL to the password-setup screen. */
export function toPasswordSetupUrl(resetUrl: string, baseUrl: string): string {
  const appBase = new URL(baseUrl);
  const authReset = new URL(resetUrl);
  if (authReset.origin !== appBase.origin) throw new Error("Password reset URL must use the configured app origin.");

  const match = authReset.pathname.match(/^\/api\/auth\/reset-password\/([^/]+)\/?$/);
  if (!match?.[1]) throw new Error("Password reset URL did not include a reset token.");
  const token = decodeURIComponent(match[1]);
  const setup = new URL(`/reset-password/${encodeURIComponent(token)}`, appBase.origin);

  const callbackUrl = authReset.searchParams.get("callbackURL");
  if (callbackUrl) {
    try {
      const callback = new URL(callbackUrl, appBase.origin);
      if (callback.origin === appBase.origin) setup.searchParams.set("callbackURL", callback.toString());
    } catch {
      // Invalid callback URLs are omitted; the password setup screen falls back to sign-in.
    }
  }
  return setup.toString();
}
