import { createHash, createHmac } from "node:crypto";
import { ConnectorError, type OnlinePaymentCapability, type OnlinePaymentEvent } from "../types.ts";
import { verifyPaymentSignature } from "./payment-signature.ts";

// Local-only test notifications are signed too. This is never a production secret or processor.
export const MOCK_PAYMENT_WEBHOOK_SECRET = "local-mock-payments-not-for-production";
export function signMockPaymentEvent(event: OnlinePaymentEvent, now = new Date()): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(now.getTime() / 1000);
  return { rawBody, signature: `t=${timestamp},v1=${createHmac("sha256", MOCK_PAYMENT_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest("hex")}` };
}
export function createMockOnlinePayments(tenantId: string, ensureAvailable: () => void): OnlinePaymentCapability {
  const accountReference = `mock_acct_${tenantId}`;
  const stable = (prefix: string, key: string) => `${prefix}_${createHash("sha256").update(`${tenantId}:${key}`).digest("hex")}`;
  return {
    async startOnboarding(input) { ensureAvailable(); return { accountReference, url: input.returnUrl }; },
    async accountStatus() { ensureAvailable(); return { accountReference, chargesEnabled: true, detailsNeeded: false }; },
    async createHostedPage(input) {
      ensureAvailable();
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^[A-Z]{3}$/.test(input.currency) || !input.idempotencyKey.trim()) throw new ConnectorError("invalid_request", "Payment details are invalid", false);
      const reference = stable("mock_session", input.idempotencyKey);
      return { reference, url: new URL(`/test-checkout/${reference}`, input.returnUrl).toString() };
    },
    async expireHostedPage() { ensureAvailable(); },
    verifyWebhook(input) {
      const event = verifyPaymentSignature(input.rawBody, input.signature, MOCK_PAYMENT_WEBHOOK_SECRET, input.now) as OnlinePaymentEvent;
      if (!event || typeof event.id !== "string" || event.id.length > 255 || typeof event.accountReference !== "string"
        || typeof event.paymentReference !== "string" || !["payment.succeeded", "payment.failed", "payment.refunded", "refund.failed"].includes(event.type)
        || !Number.isSafeInteger(event.amountMinor) || event.amountMinor <= 0 || !/^[A-Z]{3}$/.test(event.currency)
        || (event.feeMinor !== undefined && (!Number.isSafeInteger(event.feeMinor) || event.feeMinor < 0 || event.feeMinor > event.amountMinor))) throw new ConnectorError("invalid_request", "Payment notification is invalid", false);
      return event;
    },
    async requestRefund(input) {
      ensureAvailable();
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !input.paymentReference || !input.idempotencyKey) throw new ConnectorError("invalid_request", "Refund details are invalid", false);
      return { reference: stable("mock_refund", input.idempotencyKey), status: "pending" };
    },
  };
}
