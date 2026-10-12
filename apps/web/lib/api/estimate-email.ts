import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { customers, estimates, leads, loadEmailBusiness, outboundMessages, reservePlatformEmail } from "@modular-crm/db";
import { createPlatformEmailSender, customerEmailParts } from "@modular-crm/connectors";
import { getCapability } from "../connectors";
import { getServerConfig } from "../server-config";
import { getDb } from "../db";
import type { SessionActor } from "./actor";
import { recordEvent } from "./events";

/** Secure links are delivered transiently: only token hashes and redacted mail
 * receipts are persisted. Resend generates a new token, never recovers one. */
export async function sendEstimateEmail(actor: SessionActor, estimate: typeof estimates.$inferSelect, actionPath: string) {
  const db = getDb();
  const [contact] = estimate.customerId ? await db.select({ email: customers.billingEmail }).from(customers).where(and(eq(customers.tenantId, actor.tenantId), eq(customers.id, estimate.customerId))) : estimate.leadId ? await db.select({ email: leads.email }).from(leads).where(and(eq(leads.tenantId, actor.tenantId), eq(leads.id, estimate.leadId))) : [];
  const recipient = contact?.email?.trim();
  if (!recipient) return { status: "not_sent", message: "No email address is recorded. Add one and resend, or share the secure link." };
  const key = randomUUID();
  const [receipt] = await db.insert(outboundMessages).values({ tenantId: actor.tenantId, customerId: estimate.customerId, channel: "email", category: "service", recipient, renderedSubject: "Your estimate is ready", renderedBody: "Estimate approval link omitted from stored history for security.", status: "sending", templateKey: "estimate_approval", idempotencyKey: key }).returning({ id: outboundMessages.id });
  try {
    const config = getServerConfig();
    const business = await loadEmailBusiness(db, actor.tenantId, { customerId: estimate.customerId });
    const parts = customerEmailParts(`Please review your estimate and approve or decline the work: ${new URL(actionPath, config.appBaseUrl)}`, business);
    const capability = await getCapability(actor.tenantId, "email");
    if (!capability) {
      const reservation = await reservePlatformEmail(db, actor.tenantId, config.platformEmailLimits);
      if (!reservation.allowed) throw new Error("Email limit reached");
    }
    const sender = capability ?? createPlatformEmailSender(config.smtp, config.environment === "production", business, config.platformName);
    await sender.sendEmail({ to: recipient, subject: "Your estimate is ready", ...parts, idempotencyKey: key });
    await db.update(outboundMessages).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(and(eq(outboundMessages.tenantId, actor.tenantId), eq(outboundMessages.id, receipt!.id)));
    await recordEvent(actor, { type: "estimate.email_sent", entityType: "estimate", entityId: estimate.id, auditAction: "estimate.email_sent", locationId: estimate.organizationLocationId, payload: { messageId: receipt!.id } });
    return { status: "sent", message: "Estimate email accepted by the email service." };
  } catch {
    await db.update(outboundMessages).set({ status: "failed", failureCode: "estimate_email_failed", failureMessage: "Estimate email was not confirmed. Resend or share a new link.", updatedAt: new Date() }).where(and(eq(outboundMessages.tenantId, actor.tenantId), eq(outboundMessages.id, receipt!.id)));
    return { status: "not_sent", message: "Estimate email was not confirmed. Resend or share the secure link." };
  }
}
