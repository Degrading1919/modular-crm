import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { loadEmailBusiness, memberships, outboundMessages, portalAccess, sealAccountEmail, type Database } from "@modular-crm/db";
import { createPlatformEmailSender, customerEmailParts, type EmailBusiness } from "@modular-crm/connectors";
import { getServerConfig } from "./server-config";
import { getDb } from "./db";
import { authSigningSecret } from "./runtime-secret";

export async function sendPlatformEmail(to: string, subject: string, text: string, business: EmailBusiness = { name: "Modular CRM" }): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  const { smtp, environment, platformName } = getServerConfig();
  if (business.tenantId) {
    // Tenant-bound account mail uses the same durable outbox and limits as worker sends.
    await getDb().insert(outboundMessages).values({ tenantId: business.tenantId, customerId: business.customerId,
      channel: "email", category: "account", recipient: to, renderedSubject: subject,
      renderedBody: sealAccountEmail(text, authSigningSecret()), status: "queued", idempotencyKey: randomUUID() });
    return;
  }
  // A pre-tenant signup has no tenant counter; Better Auth's rate limiter protects that entry point.
  await createPlatformEmailSender(smtp, environment === "production", business, platformName).sendEmail({ to, subject,
    ...customerEmailParts(text, business), idempotencyKey: randomUUID() });
}

/** Brand password setup only when its same-origin callback names this user's portal invitation. */
export async function passwordSetupBusiness(db: Database, userId: string, setupUrl: string): Promise<EmailBusiness | undefined> {
  const callback = new URL(setupUrl).searchParams.get("callbackURL");
  if (!callback) return;
  const base = new URL(setupUrl); const invite = new URL(callback, base);
  if (invite.origin !== base.origin || invite.pathname !== "/portal/activate") return;
  const id = invite.searchParams.get("accessId");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
  const [access] = await db.select().from(portalAccess).where(and(eq(portalAccess.id, id), eq(portalAccess.userId, userId), eq(portalAccess.status, "invited"))).limit(1);
  if (access) return loadEmailBusiness(db, access.tenantId, { customerId: access.customerId });
}

export async function accountEmailBusiness(db: Database, userId: string): Promise<EmailBusiness | undefined> {
  const [access] = await db.select().from(portalAccess).where(and(eq(portalAccess.userId, userId), eq(portalAccess.status, "active"))).limit(1);
  if (access) return loadEmailBusiness(db, access.tenantId, { customerId: access.customerId });
  const [member] = await db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, "active"))).limit(1);
  if (member) return loadEmailBusiness(db, member.tenantId);
}
