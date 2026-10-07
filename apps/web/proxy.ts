import { NextResponse, type NextRequest } from "next/server";
import { findWebsiteHost, isWorkspaceHost, websiteRequestHost } from "./lib/website-host";

const unavailable = () => new NextResponse("Website unavailable", { status: 404, headers: { "cache-control": "no-store" } });
export async function proxy(request: NextRequest) {
  // Container/ALB probes contain no tenant/staff content and require no database for liveness.
  if (["/api/health/live", "/api/health/ready"].includes(request.nextUrl.pathname)) return NextResponse.next();
  const hostname = websiteRequestHost(request);
  if (!hostname) return unavailable();
  if (isWorkspaceHost(hostname) && !request.headers.has("x-website-host")) return NextResponse.next();
  let site;
  try { site = await findWebsiteHost(hostname); } catch { return unavailable(); }
  if (!site) return unavailable();
  const path = request.nextUrl.pathname;
  const headers = new Headers(request.headers);
  // Customer websites never receive staff sessions, authorization or server actions.
  headers.delete("cookie"); headers.delete("authorization"); headers.delete("next-action");
  if (request.headers.has("next-action")) return unavailable();
  const publicApi = /^\/api\/v1\/public\/(site|eligibility|quote|contact|signup)$/.test(path);
  if (publicApi) return NextResponse.next({ request: { headers } }); // Handler independently validates Host against query/body slug.
  if (!["GET", "HEAD"].includes(request.method)) return unavailable();
  if (path.startsWith("/_next/static/") || path === "/favicon.ico") return NextResponse.next({ request: { headers } });
  if (path === "/" || path === "/signup") {
    const url = request.nextUrl.clone();
    url.pathname = `/site/${site.slug}${path === "/signup" ? "/signup" : ""}`;
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (path === `/site/${site.slug}` || path === `/site/${site.slug}/signup`) return NextResponse.next({ request: { headers } });
  return unavailable();
}
