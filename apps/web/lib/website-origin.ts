import { timingSafeEqual } from "node:crypto";
/** This header is replaced by the deployed edge, not accepted from its viewers. */
export function trustedWebsiteOrigin(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  if (!request.headers.get("x-website-host")) return false;
  const supplied = Buffer.from(request.headers.get("x-website-origin-key") ?? ""), expected = Buffer.from(env.WEBSITE_ORIGIN_SECRET ?? "");
  return expected.length >= 32 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
