import { and, eq, inArray } from "drizzle-orm";
import { communicationEvents, outboundMessages, REMINDER_KEYS } from "@modular-crm/db";
import type { PaymentTransaction } from "./invoice-payment-ledger";
import type { SessionActor } from "./actor";
import { recordEvent } from "./events";

/** Must share the locked job edit transaction. Old reminders never revive. */
export async function recordJobReschedule(tx: PaymentTransaction, actor: SessionActor, job: {
  id: string; customerId: string; organizationLocationId: string | null; scheduledDate: string | null;
}, scheduledDate: string | null) {
  if (scheduledDate === job.scheduledDate || job.scheduledDate === null) return;
  const suppressed = await tx.update(outboundMessages).set({ status: "suppressed", failureCode: "visit_rescheduled", failureMessage: "The visit date changed. This reminder was not sent.", nextSendAt: null, updatedAt: new Date() })
    .where(and(eq(outboundMessages.tenantId, actor.tenantId), eq(outboundMessages.jobId, job.id), inArray(outboundMessages.templateKey, REMINDER_KEYS), inArray(outboundMessages.category, ["service", "transactional"]), inArray(outboundMessages.status, ["queued", "retry"]))).returning({ id: outboundMessages.id });
  for (const message of suppressed) await tx.insert(communicationEvents).values({ tenantId: actor.tenantId, outboundMessageId: message.id, eventType: "suppressed", payload: { reason: "visit_rescheduled" } });
  await recordEvent(actor, { type: "job.rescheduled", entityType: "job", entityId: job.id, payload: { customerId: job.customerId, jobId: job.id, previousScheduledDate: job.scheduledDate, scheduledDate }, locationId: job.organizationLocationId }, tx);
}
