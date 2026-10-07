import { and, eq } from "drizzle-orm";
import { onlinePaymentAccounts, onlinePaymentSessions } from "@modular-crm/db";
import { signMockPaymentEvent } from "@modular-crm/connectors";
import { DomainError } from "@modular-crm/domain";
import { readServerConfig } from "@modular-crm/config";
import { z } from "zod";
import { getDb } from "../db";
import { type SessionActor } from "./actor";
import { readableOnlineInvoice } from "./online-payment-sessions";
import { onlineForAccount } from "./online-payment-accounts";
import { handleOnlinePaymentWebhook } from "./online-payment-webhooks";
import { json, readBody } from "./http";
import { requirePaymentLinkFeature } from "./capability-enforcement";

/** Local mock processor UI; never available in production or when mocks are disabled. */
export async function handleMockHostedPayment(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 3 || path[0] !== "payments" || path[1] !== "test-checkout") return null;
  if (!readServerConfig(process.env).mockConnectors || process.env.NODE_ENV === "production") throw new DomainError("NOT_FOUND", "Payment page not found.", 404);
  await requirePaymentLinkFeature(actor.tenantId, "payment_collection");
  const [session] = await getDb().select().from(onlinePaymentSessions).where(and(eq(onlinePaymentSessions.tenantId, actor.tenantId), eq(onlinePaymentSessions.providerReference, path[2]!))).limit(1);
  if (!session) throw new DomainError("NOT_FOUND", "Payment page not found.", 404);
  const invoice = await readableOnlineInvoice(actor, session.invoiceId);
  const [account] = await getDb().select().from(onlinePaymentAccounts).where(and(eq(onlinePaymentAccounts.tenantId, actor.tenantId), eq(onlinePaymentAccounts.id, session.accountId), eq(onlinePaymentAccounts.provider, "mock-payments"))).limit(1);
  if (!account) throw new DomainError("NOT_FOUND", "Payment page not found.", 404);
  const receiptUrl = `/portal/documents/receipt/${session.id}`;
  if (request.method === "GET") return json({ item: { invoiceNumber: invoice.invoiceNumber, amountCents: Number(session.amountMinor), currency: session.currency, status: session.status, receiptUrl: session.status === "succeeded" ? receiptUrl : null } });
  if (request.method !== "POST") throw new DomainError("NOT_FOUND", "Payment page not found.", 404);
  const body = await readBody(request, z.object({ outcome: z.enum(["succeeded", "failed"]) }).strict());
  if (session.status === "succeeded") return json({ item: { receiptUrl, status: "succeeded" } });
  if (!["open", "failed"].includes(session.status) || session.expiresAt <= new Date()) throw new DomainError("CONFLICT", "This payment page has expired. Start a new payment from Billing.", 409);
  const online = await onlineForAccount(account);
  const status = await online.accountStatus();
  const signed = signMockPaymentEvent({ id: `mock_event_${session.id}_${body.outcome}`, accountReference: status.accountReference,
    type: body.outcome === "succeeded" ? "payment.succeeded" : "payment.failed", paymentReference: `mock_payment_${session.id}`, sessionReference: session.providerReference!,
    amountMinor: Number(session.amountMinor), currency: session.currency });
  await handleOnlinePaymentWebhook(new Request("http://localhost/api/v1/payments/webhooks/mock-payments", { method: "POST", headers: { "payment-signature": signed.signature }, body: signed.rawBody }), ["payments", "webhooks", "mock-payments"]);
  return json({ item: { status: body.outcome, receiptUrl: body.outcome === "succeeded" ? receiptUrl : null } });
}
