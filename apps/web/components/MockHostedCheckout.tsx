"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, body, money } from "./api";
import { Loading, Notice, useResource } from "./ui";

export default function MockHostedCheckout({ reference }: { reference: string }) {
  const router = useRouter();
  const endpoint = `/payments/test-checkout/${encodeURIComponent(reference)}`;
  const result = useResource<{ item: { invoiceNumber?: string; amountCents?: number; currency?: string; status?: string; receiptUrl?: string } }>(endpoint, { item: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function complete(outcome: "succeeded" | "failed") {
    setBusy(true); setError("");
    try {
      const response = await api<{ item: { status: string; receiptUrl?: string } }>(endpoint, body({ outcome }));
      router.push(response.item.receiptUrl ?? "/portal/billing");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The test payment could not be completed."); setBusy(false); }
  }
  return <main className="portal-content"><div className="card card-pad" style={{ maxWidth: 540, margin: "40px auto" }}><div className="eyebrow">Test payment page</div><h1>Pay invoice</h1><p>No real card information is needed and no money will move.</p>
    {result.loading ? <Loading label="Opening payment page…"/> : <><h2>{result.data.item.invoiceNumber}</h2>{result.data.item.amountCents != null && <p className="amount">{money(result.data.item.amountCents, result.data.item.currency)}</p>}
      {result.data.item.status === "succeeded" && result.data.item.receiptUrl ? <Link className="btn btn-primary" href={result.data.item.receiptUrl}>View receipt</Link> : !result.error && <div className="inline-actions"><button className="btn btn-primary" disabled={busy} onClick={() => complete("succeeded")}>Complete test payment</button><button className="btn btn-secondary" disabled={busy} onClick={() => complete("failed")}>Decline test payment</button></div>}</>}
    {(error || result.error) && <Notice kind="error" text={error || result.error}/>}<p><Link href="/portal/billing">Return to Billing</Link></p></div></main>;
}
