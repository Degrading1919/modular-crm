import { money } from "./api";

export default function InvoicePaymentAttention({ amountCents, currency, canRefund }: { amountCents: number; currency: string; canRefund: boolean }) {
  if (!(amountCents > 0)) return null;
  return <section className="card card-pad" role="status" style={{ marginBottom: 16 }}>
    <h2>Extra payment needs attention</h2>
    <p>{money(amountCents, currency)} was received above this invoice’s balance. Review the payment history before collecting again.</p>
    {canRefund ? <a className="btn btn-secondary" href="#invoice-refund">Refund the extra amount</a> : <p>Ask the owner to review and refund the extra amount.</p>}
  </section>;
}
