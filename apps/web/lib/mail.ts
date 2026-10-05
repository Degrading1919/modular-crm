import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { loadEmailBusiness, portalAccess, type Database } from "@modular-crm/db";
import { createPlatformEmailSender, customerEmailParts, type EmailBusiness } from "@modular-crm/connectors";
import { getServerConfig } from "./server-config";

export async function sendPlatformEmail(to: string, subject: string, text: string, business: EmailBusiness = { name: "Modular CRM" }): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  const { smtp, environment } = getServerConfig();
  await createPlatformEmailSender(smtp, environment === "production", business).sendEmail({ to, subject,
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
