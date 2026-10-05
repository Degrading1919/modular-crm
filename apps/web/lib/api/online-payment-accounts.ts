import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { connectorInstallations, onlinePaymentAccounts, organizations } from "@modular-crm/db";
import { createMockOnlinePayments, type OnlinePaymentCapability } from "@modular-crm/connectors";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { readServerConfig } from "@modular-crm/config";
import { z } from "zod";
import { getDb } from "../db";
import { getRegistry } from "../connectors";
import { openConnectorCredentials, sealConnectorCredentials } from "./connector-secrets";
import { requireStaff, type SessionActor } from "./actor";
import { requireTenantFeature } from "./capability-enforcement";
import { json, readBody } from "./http";
import { recordEvent } from "./events";

export type OnlineAccount = typeof onlinePaymentAccounts.$inferSelect;
export function paymentAccountHash(reference: string): string { return createHash("sha256").update(reference).digest("hex"); }
export function onlineProviderConfigured(key: string): boolean {
  return key === "mock-payments" ? readServerConfig(process.env).mockConnectors : Boolean(getRegistry().getDefinition(key)?.manifest.guidedPayments);
}
export async function onlineForAccount(account: OnlineAccount, allowSetup = false): Promise<OnlinePaymentCapability> {
  if (!onlineProviderConfigured(account.provider)) throw new DomainError("EXTERNAL_SERVICE_ERROR", "Online payments are unavailable. Contact your service team.", 503);
  const [installation] = await getDb().select().from(connectorInstallations)
    .where(and(eq(connectorInstallations.id, account.installationId), eq(connectorInstallations.tenantId, account.tenantId), eq(connectorInstallations.connectorKey, account.provider))).limit(1);
  if (!installation || (!allowSetup && installation.status !== "connected")) throw new DomainError("EXTERNAL_SERVICE_ERROR", "Online payments need to be reconnected.", 503);
  if (account.provider === "mock-payments") return createMockOnlinePayments(account.id, () => {});
  const credentials = installation.credentialReference ? openConnectorCredentials(installation.credentialReference, { tenantId: account.tenantId, installationId: installation.id, connectorKey: account.provider }) : {};
  const online = getRegistry().getDefinition(account.provider)?.createConfiguredScope?.({ tenantId: account.tenantId, credentials, now: () => new Date(), ensureAvailable: () => {} }).payments?.online;
  if (!online) throw new DomainError("EXTERNAL_SERVICE_ERROR", "Online payments are unavailable.", 503);
  return online;
}

/** Owner-controlled business binding; neither public callbacks nor browser fields set readiness. */
export async function handleOnlinePaymentAccounts(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 3 || path[0] !== "connections" || path[2] !== "online-payments") return null;
  requireStaff(actor);
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Only the owner can set up online payments.", 403);
  requirePermission(actor, request.method === "GET" ? "connectors.read" : "connectors.configure");
  if (request.method === "POST") requirePermission(actor, "connectors.install");
  await requireTenantFeature(actor.tenantId, "payment_collection");
  const provider = path[1]!;
  if (!onlineProviderConfigured(provider)) throw new DomainError("NOT_FOUND", "This payment service is not available.", 404);
  const body = request.method === "POST" || request.method === "PATCH"
    ? await readBody(request, z.object({ organizationId: z.uuid().optional(), allowPartial: z.boolean().optional() }).strict()) : {};
  const organizationId = body.organizationId ?? new URL(request.url).searchParams.get("organizationId") ?? actor.organizationId;
  const [organization] = await getDb().select({ id: organizations.id }).from(organizations).where(and(eq(organizations.tenantId, actor.tenantId), eq(organizations.id, organizationId ?? ""))).limit(1);
  if (!organization) throw new DomainError("NOT_FOUND", "Business not found.", 404);
  // History describes the selected business, retaining the actual owner's actor identity.
  const historyActor = { ...actor, organizationId: organization.id };
  let [account] = await getDb().select().from(onlinePaymentAccounts).where(and(eq(onlinePaymentAccounts.tenantId, actor.tenantId), eq(onlinePaymentAccounts.organizationId, organization.id))).limit(1);
  if (account && account.provider !== provider) throw new DomainError("CONFLICT", "This business already uses another payment service.", 409);
  if (!account && request.method === "GET") return json({ item: { status: "not_connected", message: "Set up online payments", allowPartial: false } });
  if (!account && request.method === "POST") account = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select id from organizations where tenant_id=${actor.tenantId} and id=${organization.id} for update`);
    const [prior] = await tx.select().from(onlinePaymentAccounts).where(and(eq(onlinePaymentAccounts.tenantId, actor.tenantId), eq(onlinePaymentAccounts.organizationId, organization.id))).limit(1);
    if (prior) {
      if (prior.provider !== provider) throw new DomainError("CONFLICT", "A payment service is already being set up.", 409);
      return prior;
    }
    const [installation] = await tx.insert(connectorInstallations).values({ tenantId: actor.tenantId, organizationId: organization.id, connectorKey: provider, displayName: provider === "mock-payments" ? "Test online payments" : "Stripe", status: "authorizing" }).returning();
    const [created] = await tx.insert(onlinePaymentAccounts).values({ tenantId: actor.tenantId, organizationId: organization.id, installationId: installation!.id, provider }).returning();
    return created!;
  });
  if (!account) throw new DomainError("CONFLICT", "Set up online payments first.", 409);
  if (request.method === "GET") {
    const [installation] = await getDb().select({ status: connectorInstallations.status }).from(connectorInstallations).where(and(eq(connectorInstallations.id, account.installationId), eq(connectorInstallations.tenantId, actor.tenantId))).limit(1);
    if (installation?.status === "not_connected") return json({ item: { status: "not_connected", message: "Online payments are disconnected", allowPartial: account.allowPartial } });
  }
  if (request.method === "DELETE") {
    requirePermission(actor, "connectors.disconnect");
    await getDb().transaction(async (tx) => {
      await tx.update(onlinePaymentAccounts).set({ chargesEnabled: false }).where(and(eq(onlinePaymentAccounts.id, account!.id), eq(onlinePaymentAccounts.tenantId, actor.tenantId)));
      // Retain the encrypted binding for outstanding provider confirmations and history.
      await tx.update(connectorInstallations).set({ status: "not_connected" }).where(and(eq(connectorInstallations.id, account!.installationId), eq(connectorInstallations.tenantId, actor.tenantId)));
      await recordEvent(historyActor, { type: "connector.disconnected", entityType: "connector_installation", entityId: account!.installationId, auditAction: "payment.disconnect", payload: { provider } }, tx);
    });
    return json({ item: { status: "not_connected", message: "Online payments are disconnected" } });
  }
  if (request.method === "PATCH") {
    requirePermission(actor, "billing.settings_manage");
    if (body.allowPartial === undefined) throw new DomainError("VALIDATION_ERROR", "Choose whether customers can make partial payments.", 422);
    await getDb().transaction(async (tx) => {
      await tx.update(onlinePaymentAccounts).set({ allowPartial: body.allowPartial }).where(and(eq(onlinePaymentAccounts.id, account!.id), eq(onlinePaymentAccounts.tenantId, actor.tenantId)));
      await recordEvent(historyActor, { type: "payment.settings_updated", entityType: "connector_installation", entityId: account!.installationId, auditAction: "payment.settings", after: { allowPartial: body.allowPartial } }, tx);
    });
    return json({ item: { allowPartial: body.allowPartial } });
  }
  const capability = await onlineForAccount(account, true);
  const saveAccount = async (reference: string) => {
    const envelope = sealConnectorCredentials({ accountReference: reference }, { tenantId: actor.tenantId, installationId: account!.installationId, connectorKey: provider });
    await getDb().transaction(async (tx) => {
      await tx.update(connectorInstallations).set({ credentialReference: envelope, providerAccountId: null }).where(and(eq(connectorInstallations.id, account!.installationId), eq(connectorInstallations.tenantId, actor.tenantId)));
      await tx.update(onlinePaymentAccounts).set({ accountHash: paymentAccountHash(reference) }).where(and(eq(onlinePaymentAccounts.id, account!.id), eq(onlinePaymentAccounts.tenantId, actor.tenantId)));
    });
  };
  if (request.method === "POST") {
    await getDb().update(connectorInstallations).set({ status: "authorizing" }).where(and(eq(connectorInstallations.id, account.installationId), eq(connectorInstallations.tenantId, actor.tenantId)));
    const base = readServerConfig(process.env).appBaseUrl;
    const returnUrl = new URL("/app/connections", base).toString();
    const result = await capability.startOnboarding({ returnUrl, refreshUrl: returnUrl, idempotencyKey: `onboarding:${account.id}`, saveAccount });
    await saveAccount(result.accountReference);
    await recordEvent(historyActor, { type: "connector.authorization_started", entityType: "connector_installation", entityId: account.installationId, auditAction: "payment.onboarding", payload: { provider } });
    return json({ item: { authorizationUrl: result.url } });
  }
  if (request.method !== "GET") throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  if (!account.accountHash) return json({ item: { status: "authorizing", message: "Finish setting up online payments", allowPartial: account.allowPartial } });
  const status = await capability.accountStatus();
  if (paymentAccountHash(status.accountReference) !== account.accountHash) throw new DomainError("CONFLICT", "Reconnect this payment service.", 409);
  await getDb().transaction(async (tx) => {
    await tx.update(onlinePaymentAccounts).set({ chargesEnabled: status.chargesEnabled, detailsNeeded: status.detailsNeeded }).where(and(eq(onlinePaymentAccounts.id, account!.id), eq(onlinePaymentAccounts.tenantId, actor.tenantId)));
    await tx.update(connectorInstallations).set({ status: status.chargesEnabled ? "connected" : "needs_attention", healthCheckedAt: new Date() }).where(and(eq(connectorInstallations.id, account!.installationId), eq(connectorInstallations.tenantId, actor.tenantId)));
  });
  return json({ item: { status: status.chargesEnabled ? "connected" : "needs_attention", message: status.chargesEnabled && !status.detailsNeeded ? "Ready to accept cards" : provider === "mock-payments" ? "Test payments need setup" : status.detailsNeeded ? "Stripe needs a few more details" : "Stripe is reviewing your payment setup", detailsNeeded: status.detailsNeeded, allowPartial: account.allowPartial } });
}
