"use client";

import { useRef, useState } from "react";
import { api, body, money } from "./api";

export type RefundPaymentContext = {
  id: string;
  amountCents: number;
  refundedCents: number;
  status: string;
  sourceType: string;
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
    && payment.amountCents > payment.refundedCents,
  );
  const [paymentId, setPaymentId] = useState(refundablePayments[0]?.id ?? "");
  const selected = refundablePayments.find((payment) => payment.id === paymentId) ?? refundablePayments[0];
  const maxCents = selected ? selected.amountCents - selected.refundedCents : 0;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const retryKey = useRef("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const amountCents = Number(amount) * 100;
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > maxCents) {
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
      onRefunded?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t complete the refund. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (refundablePayments.length === 0) return null;

  return <form className="card card-pad" onSubmit={submit} aria-label="Refund invoice payment">
    <div className="card-heading"><div><h2>Refund a payment</h2><p className="subtle" style={{ fontSize: ".84rem", margin: "4px 0 0" }}>Current balance {money(balanceCents, currency)}. Refunds are recorded in your account history and reopen the invoice balance.</p></div></div>
    {refundablePayments.length > 1 && <label className="field">Payment
      <select value={selected?.id ?? ""} onChange={(event) => { setPaymentId(event.target.value); setAmount(""); }}>
        {refundablePayments.map((payment) => <option key={payment.id} value={payment.id}>
          {money(payment.amountCents - payment.refundedCents, currency)} remaining · {payment.sourceType === "manual" ? "Manual payment" : "Test payment"}
        </option>)}
      </select>
    </label>}
    <label className="field">Refund amount ({currency})
      <input inputMode="decimal" type="number" min="0.01" max={(maxCents / 100).toFixed(2)} step="0.01" value={amount}
        onChange={(event) => setAmount(event.target.value)} required aria-describedby="refund-limit" />
      <span id="refund-limit" className="subtle">Up to {money(maxCents, currency)} for this payment.</span>
    </label>
    {maxCents > 0 && <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAmount((maxCents / 100).toFixed(2))}>Refund remaining {money(maxCents, currency)}</button>}
    <label className="field">Reason (optional)
      <textarea maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Add a note for your records" />
    </label>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <button className="btn btn-primary" type="submit" disabled={saving || !selected || maxCents <= 0}>{saving ? "Recording refund…" : "Record refund"}</button>
  </form>;
}
