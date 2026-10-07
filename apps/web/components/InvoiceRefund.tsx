"use client";

import { useRef, useState } from "react";
import { paymentMethodLabel } from "@modular-crm/domain";
import { api, body, money } from "./api";
import { refundReviewConfirmation } from "../lib/refund-review-copy";

export type RefundPaymentContext = {
  id: string;
  amountCents: number;
  refundedCents: number;
  pendingRefundCents?: number;
  overpaymentCents?: number;
  refundReviews?: { id: string; amountCents: number; recordedAmountCents?: number; status: "needs_review"; message: string }[];
  status: string;
  sourceType: string;
  method?: string;
  reference?: string | null;
  createdAt: string;
};

type RefundResponse = {
  duplicate: boolean;
  invoice: { balanceCents: number };
  item: { id: string; paymentId: string; amountMinor: number; currency: string; status: string };
};

/** A standalone refund form for an invoice detail surface. */
export default function InvoiceRefund({
  invoiceId,
  balanceCents,
  currency = "USD",
  payments: paymentContext,
  onRefunded,
}: {
  invoiceId: string;
  balanceCents: number;
  currency?: string;
  payments: RefundPaymentContext[];
  onRefunded?: (result: RefundResponse) => void;
}) {
  const refundablePayments = paymentContext.filter((payment) =>
    ["succeeded", "partially_refunded"].includes(payment.status)
    && !payment.refundReviews?.length
    && payment.amountCents > payment.refundedCents + (payment.pendingRefundCents ?? 0),
  ).sort((a, b) => Number(b.method === "card") - Number(a.method === "card"));
  const [paymentId, setPaymentId] = useState(refundablePayments[0]?.id ?? "");
  const selected = refundablePayments.find((payment) => payment.id === paymentId) ?? refundablePayments[0];
  const maxCents = selected ? selected.amountCents - selected.refundedCents - (selected.pendingRefundCents ?? 0) : 0;
  const [amount, setAmount] = useState<string | null>(null);
  const enteredAmount = amount ?? (selected?.overpaymentCents ? (Math.min(selected.overpaymentCents, maxCents) / 100).toFixed(2) : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const retryKey = useRef("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const amountCents = Math.round(Number(enteredAmount) * 100);
    if (!/^\d+(?:\.\d{1,2})?$/.test(enteredAmount) || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > maxCents) {
      setError(`Enter an amount between ${money(1, currency)} and ${money(maxCents, currency)}.`);
      return;
    }
    if (!retryKey.current) retryKey.current = crypto.randomUUID();
    setSaving(true);
    setError(null);
    try {
      const result = await api<RefundResponse>(`/invoices/${invoiceId}/refunds`, body({
        paymentId: selected.id,
        amountCents,
        reason: reason.trim() || undefined,
        idempotencyKey: retryKey.current,
      }));
      retryKey.current = "";
      setAmount("");
      setReason("");
      setNotice(result.item.status === "needs_review" ? "This refund needs review. Check the payment service before starting another refund." : result.item.status === "pending" ? "Your refund is awaiting confirmation from the payment service." : result.item.status === "failed" ? "The refund did not go through. Review the payment before starting a new refund." : "Refund recorded.");
      onRefunded?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t complete the refund. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const reviews = paymentContext.flatMap((payment) => payment.refundReviews ?? []);
  async function resolve(id: string, outcome: "refunded" | "not_refunded") {
    const review = reviews.find((item) => item.id === id);
    const payment = paymentContext.find((item) => item.refundReviews?.some((item) => item.id === id));
    if (!window.confirm(refundReviewConfirmation(outcome, review?.amountCents ?? 0, payment?.refundedCents ?? 0, payment?.amountCents ?? 0, currency, review?.recordedAmountCents ?? 0))) return;
    setSaving(true); setError(null);
    try {
      const result = await api<RefundResponse>(`/invoices/${invoiceId}/refunds/${id}/resolve`, body({ outcome }));
      setNotice("Refund review resolved."); onRefunded?.(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t resolve this refund review. Please try again."); }
    finally { setSaving(false); }
  }
  if (reviews.length) return <section className="card card-pad" role="status"><h2>Refund needs review</h2><p>Recorded money has not been changed.</p><p>Check the payment service, then record what actually happened. This does not send another refund.</p>{reviews.map((review) => <div key={review.id}><p>{money(review.amountCents, currency)} · {review.message}</p><div className="inline-actions"><button className="btn btn-primary" type="button" disabled={saving} onClick={() => void resolve(review.id, "refunded")}>The refund went through</button><button className="btn btn-secondary" type="button" disabled={saving} onClick={() => void resolve(review.id, "not_refunded")}>No refund happened</button></div></div>)}{error && <p className="notice notice-error" role="alert">{error}</p>}</section>;
  if (refundablePayments.length === 0) return paymentContext.some((payment) => (payment.pendingRefundCents ?? 0) > 0) ? <p role="status" className="notice">Your refund is awaiting confirmation from the payment service.</p> : null;

  return <form id="invoice-refund" className="card card-pad" onSubmit={submit} aria-label="Refund invoice payment">
    <div className="card-heading"><div><h2>Refund a payment</h2><p className="subtle" style={{ fontSize: ".84rem", margin: "4px 0 0" }}>Current balance {money(balanceCents, currency)}. Refunds are recorded in your account history and update the invoice balance.</p></div></div>
    {refundablePayments.length > 1 && <label className="field">Payment
      <select value={selected?.id ?? ""} onChange={(event) => { setPaymentId(event.target.value); setAmount(null); }}>
        {refundablePayments.map((payment) => <option key={payment.id} value={payment.id}>
          {money(payment.amountCents - payment.refundedCents - (payment.pendingRefundCents ?? 0), currency)} remaining · {paymentMethodLabel(payment.method, payment.sourceType)}{payment.reference ? ` · ${payment.reference}` : ""}
        </option>)}
      </select>
    </label>}
    <label className="field">Refund amount ({currency})
      <input inputMode="decimal" type="number" min="0.01" max={(maxCents / 100).toFixed(2)} step="0.01" value={enteredAmount}
        onChange={(event) => setAmount(event.target.value)} required aria-describedby="refund-limit" />
      <span id="refund-limit" className="subtle">Up to {money(maxCents, currency)} for this payment.</span>
    </label>
    {maxCents > 0 && <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAmount((maxCents / 100).toFixed(2))}>Refund remaining {money(maxCents, currency)}</button>}
    <label className="field">Reason (optional)
      <textarea maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Add a note for your records" />
    </label>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {(selected?.pendingRefundCents ?? 0) > 0 && <p role="status" className="notice">{money(selected!.pendingRefundCents, currency)} is awaiting confirmation from the payment service.</p>}
    <button className="btn btn-primary" type="submit" disabled={saving || !selected || maxCents <= 0}>{saving ? "Submitting refund…" : selected?.method === "card" ? "Refund payment" : "Record refund"}</button>
  </form>;
}
