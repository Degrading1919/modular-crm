import { isIP } from "node:net";
import { trustedProxyHops } from "@modular-crm/config";
import { trustedWebsiteOrigin } from "../website-origin";

/** Ingress must admit only the configured proxy path; never trust client-supplied left entries. */
export function clientAddress(request: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = trustedProxyHops(env);
  if (!configured) return "local";
  // Workspace traffic is ALB -> app; authenticated website-origin traffic adds
  // CloudFront before that same chain. A viewer cannot opt into the extra hop.
  const hops = configured + (trustedWebsiteOrigin(request, env) ? 1 : 0);
  const header = request.headers.get("x-forwarded-for");
  if (!header || header.length > 8192) return "local";
  const entries = header.split(",");
  if (entries.length < hops) return "local";
  let value = entries[entries.length - hops]!.trim();
  // ALB can preserve client ports, including bracketed IPv6.
  const withPort = value.match(/^(?:\[([0-9a-fA-F:]+)\]|(\d{1,3}(?:\.\d{1,3}){3})):(\d{1,5})$/);
  if (withPort) {
    if (Number(withPort[3]) < 1 || Number(withPort[3]) > 65535) return "local";
    value = withPort[1] ?? withPort[2]!;
  }
  if (!isIP(value)) return "local";
  // Canonicalize IPv6 aliases so textual variations cannot create new budgets.
  return isIP(value) === 6 ? new URL(`http://[${value}]`).hostname.slice(1, -1) : value;
}
