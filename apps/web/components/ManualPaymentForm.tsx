"use client";

import { useRef, useState } from "react";
import { manualPaymentMethods, paymentMethodLabel, type ManualPaymentMethod } from "@modular-crm/domain";
import { api, body, money } from "./api";
import SearchPicker, { type PickerRecord } from "./SearchPicker";
import { Notice } from "./ui";

export type PaymentInvoice = PickerRecord & { openBalanceCents?: number; balanceCents?: number; currency?: string };
export function invoiceChoice(item: PickerRecord): string {
  return `${item.number} · ${item.customerName} · ${money(Number(item.openBalanceCents), String(item.currency || "USD"))} due · ${item.locationName}`;
}

export default function ManualPaymentForm({ invoice: initialInvoice, onClose, onSaved }: {
  invoice?: PaymentInvoice; onClose: () => void; onSaved: (item: PickerRecord) => void;
}) {
  const [invoice, setInvoice] = useState<PaymentInvoice | null>(initialInvoice ?? null);
  const [amount, setAmount] = useState(initialInvoice ? (Number(initialInvoice.openBalanceCents ?? initialInvoice.balanceCents) / 100).toFixed(2) : "");
  const [method, setMethod] = useState<ManualPaymentMethod | "">("");
  const [reference, setReference] = useState("");
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const changed = () => { setPaymentKey(crypto.randomUUID()); setError(""); };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!invoice || !method) { setError("Choose an invoice and how the customer paid."); return; }
    submitting.current = true; setSaving(true); setError("");
    try {
      const response = await api<{ item: PickerRecord }>(`/invoices/${invoice.id}/pay`, body({ amountCents: Math.round(Number(amount) * 100), method, reference: reference.trim(), idempotencyKey: paymentKey }));
      onSaved(response.item);
    } catch (issue) { setError((issue as Error).message); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <form onSubmit={submit}>
    <p className="subtle">Record money you have already received. This does not charge a card or collect a new payment.</p>
    <div className="form-grid">
      {!initialInvoice && <SearchPicker label="Invoice" endpoint="/invoices?open=1" required selected={invoice} describe={invoiceChoice} onSelect={(item) => {
        setInvoice(item); setAmount(item ? (Number(item.openBalanceCents) / 100).toFixed(2) : ""); changed();
      }}/>}
      {initialInvoice && <p className="full subtle">Invoice {String(initialInvoice.number ?? "")} · {money(Number(initialInvoice.openBalanceCents ?? initialInvoice.balanceCents), initialInvoice.currency)} due</p>}
      <div className="field"><label htmlFor="pay-amount">Amount</label><input id="pay-amount" type="number" min="0.01" max={invoice ? (Number(invoice.openBalanceCents ?? invoice.balanceCents) / 100).toFixed(2) : undefined} step="0.01" required value={amount} onChange={(event) => { setAmount(event.target.value); changed(); }}/></div>
      <div className="field"><label htmlFor="pay-method">How the customer paid</label><select id="pay-method" required value={method} onChange={(event) => { setMethod(event.target.value as ManualPaymentMethod); changed(); }}><option value="">Choose payment method</option>{manualPaymentMethods.map((value) => <option key={value} value={value}>{paymentMethodLabel(value)}</option>)}</select></div>
      <div className="field full"><label htmlFor="pay-reference">Reference (optional)</label><input id="pay-reference" maxLength={200} placeholder="For example, a check number" value={reference} onChange={(event) => { setReference(event.target.value); changed(); }}/></div>
    </div>
    {error && <Notice kind="error" text={error}/>}
    <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Recording…" : "Record payment"}</button></div>
  </form>;
}
