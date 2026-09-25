import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  automationRules, grantRecommendedCapabilitySetup, installInitialCapabilityCatalog, memberships,
  organizationLocations, organizations, roleTemplates, services, siteContents, sites, tenants, ticketStatusDefinitions, ticketTypeDefinitions,
} from "@modular-crm/db";
import { DomainError } from "@modular-crm/domain";
import { evaluateProductCapabilityRecommendations, PET_WASTE_REMOVAL_PACK } from "@modular-crm/industry-packs";
import { auth } from "../auth";
import { getDb } from "../db";
import { requireActor } from "./actor";
import { json, readBody } from "./http";

const credentials = z.object({ email: z.email(), password: z.string().min(1) });
const registration = credentials.extend({ name: z.string().min(2).max(120), businessName: z.string().min(2).max(160) });

// V1 auth routes call Better Auth's API directly, outside its HTTP handler
// middleware. Bound malformed traffic by IP, while isolating credential
// guessing by normalized email and IP so an office NAT can share the app.
const AUTH_RATE_WINDOW_MS = 10 * 60 * 1000;
const AUTH_IP_RATE_LIMIT = 300;
const AUTH_EMAIL_RATE_LIMIT = 5;
const authRateWindows = new Map<string, { startedAt: number; count: number }>();

function clientIpHash(request: Request): string {
  const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(rawIp.slice(0, 160)).digest("hex").slice(0, 24);
}

function consumeAuthRateLimit(key: string, limit: number): Response | null {
  const now = Date.now();
  let window = authRateWindows.get(key);
  if (!window || now - window.startedAt >= AUTH_RATE_WINDOW_MS) {
    window = { startedAt: now, count: 0 };
    authRateWindows.set(key, window);
  }
  if (window.count >= limit) {
    const retryAfter = Math.ceil((window.startedAt + AUTH_RATE_WINDOW_MS - now) / 1000);
    return json({ error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Please try again in a few minutes." } }, 429, { "retry-after": String(retryAfter) });
  }
  window.count += 1;
  if (authRateWindows.size > 5000) {
    for (const [entry, value] of authRateWindows) if (now - value.startedAt >= AUTH_RATE_WINDOW_MS) authRateWindows.delete(entry);
    while (authRateWindows.size > 7500) authRateWindows.delete(authRateWindows.keys().next().value!);
  }
  return null;
}

function rateLimitAuthIp(request: Request): Response | null {
  return consumeAuthRateLimit(`ip:${clientIpHash(request)}`, AUTH_IP_RATE_LIMIT);
}

function credentialRateKey(request: Request, email: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  const digest = createHash("sha256").update(`${normalizedEmail}\0${clientIpHash(request)}`).digest("hex");
  return `credential:${digest}`;
}

function slugify(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business"; }

export async function handleAuthRoute(request: Request, path: string[]): Promise<Response> {
  const action = path[1];
  if (action === "login" && request.method === "POST") {
    const limited = rateLimitAuthIp(request);
    if (limited) return limited;
    const body = await readBody(request, credentials);
    const emailKey = credentialRateKey(request, body.email);
    const credentialLimited = consumeAuthRateLimit(emailKey, AUTH_EMAIL_RATE_LIMIT);
    if (credentialLimited) return credentialLimited;
    const response = await auth.api.signInEmail({ body, headers: request.headers, asResponse: true });
    if (response.ok) authRateWindows.delete(emailKey);
    return response;
  }
  if (action === "logout" && request.method === "POST") {
    return auth.api.signOut({ headers: request.headers, asResponse: true });
  }
  if (action === "me" && request.method === "GET") {
    const actor = await requireActor(request);
    return json({ user: { id: actor.userId, name: actor.name, email: actor.email, role: actor.kind === "staff" ? actor.role : "customer", permissions: actor.kind === "staff" ? [...actor.permissions] : [] }, tenant: { id: actor.tenantId, name: actor.tenantName, packKey: actor.packKey } });
  }
  if (action === "register" && request.method === "POST") {
    const limited = rateLimitAuthIp(request);
    if (limited) return limited;
    const body = await readBody(request, registration);
    const db = getDb();
    const signupResponse = await auth.api.signUpEmail({ body: { name: body.name, email: body.email, password: body.password }, headers: request.headers, asResponse: true });
    if (!signupResponse.ok) return signupResponse;
    const signup = await signupResponse.clone().json() as { user?: { id?: string } };
    const userId = signup.user?.id;
    if (!userId) throw new DomainError("CONFLICT", "Account was created, but business setup did not finish. Sign in and contact support.", 409);
    const slug = `${slugify(body.businessName)}-${randomUUID().slice(0, 6)}`;
    await db.transaction(async (tx) => {
      await installInitialCapabilityCatalog(tx);
      const [tenant] = await tx.insert(tenants).values({ name: body.businessName, slug, status: "active", industryPackKey: PET_WASTE_REMOVAL_PACK.key, industryPackVersion: PET_WASTE_REMOVAL_PACK.version, settings: { onboardingComplete: false, capabilitySetupComplete: false, servicePostalCodes: [], demoMode: true } }).returning();
      if (!tenant) throw new Error("Tenant creation failed");
      const recommendedFeatures = evaluateProductCapabilityRecommendations(PET_WASTE_REMOVAL_PACK, {})
        .filter((item) => item.recommendation === "normally_recommended")
        .map((item) => item.featureKey);
      await grantRecommendedCapabilitySetup(tx, tenant.id, recommendedFeatures, {
        source: "signup_recommendation",
        sourceReference: PET_WASTE_REMOVAL_PACK.key,
      });
      const [organization] = await tx.insert(organizations).values({ tenantId: tenant.id, legalName: body.businessName, displayName: body.businessName, organizationType: "business" }).returning();
      if (!organization) throw new Error("Organization creation failed");
      const [branch] = await tx.insert(organizationLocations).values({ tenantId: tenant.id, organizationId: organization.id, name: "Main location", code: "MAIN" }).returning();
      const [role] = await tx.insert(roleTemplates).values({ tenantId: tenant.id, key: "owner", name: "Owner / Admin", description: "Business owner", system: true }).returning();
      if (!branch || !role) throw new Error("Business setup failed");
      const [membership] = await tx.insert(memberships).values({ tenantId: tenant.id, userId, organizationId: organization.id, defaultLocationId: branch.id, roleTemplateId: role.id, status: "active", joinedAt: new Date() }).returning();
      await tx.insert(services).values(PET_WASTE_REMOVAL_PACK.services.map((service) => ({ tenantId: tenant.id, organizationId: organization.id, key: service.key, name: service.name, serviceType: service.kind, defaultDurationMinutes: service.estimatedMinutes ?? 20, active: service.defaultEnabled ?? false })));
      await tx.insert(ticketTypeDefinitions).values({ tenantId: tenant.id, key: "plan_change_review", name: "Service plan change review" });
      await tx.insert(ticketStatusDefinitions).values({ tenantId: tenant.id, key: "open", name: "Open", normalizedCategory: "open", sortOrder: 1 });
      const [site] = await tx.insert(sites).values({ tenantId: tenant.id, organizationId: organization.id, status: "draft", templateKey: PET_WASTE_REMOVAL_PACK.website.template, templateVersion: "1", slug, branding: { businessName: body.businessName }, settings: { serviceArea: [] } }).returning();
      if (site) await tx.insert(siteContents).values({ tenantId: tenant.id, siteId: site.id, contentKey: "home", content: { headline: PET_WASTE_REMOVAL_PACK.website.heroHeadline, description: PET_WASTE_REMOVAL_PACK.website.heroDescription } });
      if (membership) await tx.insert(automationRules).values(PET_WASTE_REMOVAL_PACK.defaultAutomations.map((recipe) => ({ tenantId: tenant.id, name: recipe.name, description: recipe.description, source: "industry_pack", sourceKey: recipe.sourceKey, status: recipe.enabledByDefault ? "active" : "draft", version: 1, triggerConfig: { event: recipe.event, ...(recipe.filters ? { filters: recipe.filters } : {}) }, conditions: {}, actions: recipe.actions.map((action) => ({ actionType: action.actionType, configuration: action.configuration })), createdByMembershipId: membership.id })));
    });
    return signupResponse;
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}
