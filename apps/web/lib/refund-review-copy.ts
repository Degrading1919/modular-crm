import { moneyValue } from "./presentation";

export function refundReviewConfirmation(outcome: "refunded" | "not_refunded", amount: number, refunded: number, collected: number, currency: string, alreadyRecorded = 0) {
  if (outcome === "not_refunded") return "Confirm you checked the payment service and no refund happened. This removes the refund from the recorded balance if needed.";
  const excess = Math.max(0, amount + refunded - alreadyRecorded - collected);
  return "Confirm you checked the payment service and this refund went through. This records the refund and updates the invoice balance." + (excess > 0 ? ` Warning: recorded refunds would exceed this payment by ${moneyValue(excess, currency)}. The invoice balance may exceed its original total. Check that this is a separate, real refund, not a duplicate record, before confirming.` : "");
}
