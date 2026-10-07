import { DomainError } from "@modular-crm/domain";
import { createWebsiteDnsResolver, mockWebsiteDnsResolver, mockWebsiteEdgeProvider } from "./website-dns.ts";
import { createCloudFrontWebsiteProvider } from "./website-cloudfront.ts";

export function createWebsiteHosting(env: Record<string, string | undefined> = process.env, demo = false) {
  const mock = env.NODE_ENV !== "production" && (demo || env.DOMAIN_VERIFICATION_MODE === "mock");
  if (mock) return { mock: true, target: "sites.example.test", dns: mockWebsiteDnsResolver, edge: mockWebsiteEdgeProvider };
  const target = env.WEBSITE_ROUTING_TARGET;
  if (env.WEBSITE_DOMAIN_PROVIDER !== "cloudfront" || !target || !/^[a-z0-9-]+\.cloudfront\.net$/.test(target)
    || !env.WEBSITE_DISTRIBUTION_ID || !env.WEBSITE_CONNECTION_GROUP_ID || !env.WEBSITE_RESOURCE_TAG) {
    throw new DomainError("CONFLICT", "Custom website addresses are not configured yet. Your included address still works.", 503);
  }
  return { mock: false, target, dns: createWebsiteDnsResolver(),
    edge: createCloudFrontWebsiteProvider(env.WEBSITE_DISTRIBUTION_ID, env.WEBSITE_CONNECTION_GROUP_ID, env.WEBSITE_RESOURCE_TAG) };
}
