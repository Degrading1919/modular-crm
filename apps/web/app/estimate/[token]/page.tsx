"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { priceDocument, type DocumentPricing } from "@modular-crm/domain";
import { MoneyTotals } from "../../../components/DocumentEditor";

type EstimateView = {
  title: string;
  contactName: string | null;
  currency: string;
  totalMinor: number;
  expiresAt: string;
  termsText: string | null;
  termsVersion: string;
  pricing?: DocumentPricing;
  items: Array<{ id:string;description: string; quantity: string; unitAmountMinor: number; totalMinor: number;discountMinor?:number;taxable?:boolean;optional?:boolean }>;
};

type ApiError = { error?: { message?: string } };

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

export default function PublicEstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<EstimateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [selected,setSelected] = useState<string[]>([]);
  let chosen:DocumentPricing|undefined,choiceError="";
  if(estimate?.pricing?.version===1) try {chosen=priceDocument(estimate.items.filter(line=>!line.optional||selected.includes(line.id)),estimate.pricing.taxRateBasisPoints,estimate.pricing.discount);}catch(error){choiceError=(error as Error).message;}

  useEffect(() => {
    let active = true;
    void params.then(({ token: value }) => {
      if (!active) return;
      setToken(value);
      void fetch(`/api/v1/public/estimate-links/${encodeURIComponent(value)}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { item?: EstimateView } & ApiError;
          if (!response.ok || !payload.item) throw new Error(payload.error?.message || "This estimate link is unavailable.");
          if (active) setEstimate(payload.item);
        })
        .catch((error: unknown) => { if (active) setFailure(error instanceof Error ? error.message : "This estimate link is unavailable."); })
        .finally(() => { if (active) setLoading(false); });
    });
    return () => { active = false; };
  }, [params]);

  async function decide(action: "approve" | "decline") {
    if (!token || working || (action === "approve" && !acceptedTerms)) return;
    setWorking(true);
    setFailure("");
    try {
      const response = await fetch(`/api/v1/public/estimate-links/${encodeURIComponent(token)}/${action}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "approve" ? {acceptedOptionalIds:selected} : {}),
      });
      const payload = await response.json() as { item?: { status?: string }; duplicate?: boolean } & ApiError;
      if (!response.ok) throw new Error(payload.error?.message || "Your decision could not be saved. Please try again.");
      setMessage(action === "approve" ? "Thank you. Your estimate is approved." : "Your response has been recorded.");
      if (payload.item?.status) setEstimate((current) => current ? { ...current, title: current.title } : current);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Your decision could not be saved. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  return <main className="onboarding">
    <header className="onboarding-header">
      <Link className="brand" href="/" aria-label="Modular CRM home"><span className="brand-mark">m</span> modular<span className="brand-dot">.</span></Link>
      <span className="muted-label">Estimate review</span>
    </header>
    <section className="onboarding-main">
      {loading ? <div className="loading" role="status"><span className="spinner" />Loading estimate…</div> : null}
      {!loading && failure && !estimate ? <div className="card onboarding-card"><h1>Estimate unavailable</h1><p>{failure}</p></div> : null}
      {estimate ? <article className="card onboarding-card">
        <p className="eyebrow">Estimate</p>
        <h1>{estimate.title}</h1>
        {estimate.contactName ? <p className="subtle">Prepared for {estimate.contactName}</p> : null}
        <div className="stack">
          <div className="card card-pad">
            <div className="card-heading"><h2>Work and pricing</h2><strong className="amount">{money(chosen?.totalMinor ?? estimate.totalMinor, estimate.currency)}</strong></div>
            {estimate.items.length ? <div className="stack">
              {estimate.items.map((line, index) => <div key={`${line.description}-${index}`} className="route-stop">
                <div>{line.optional ? <label><input type="checkbox" disabled={!!message||working} checked={selected.includes(line.id)} onChange={event=>setSelected(prior=>event.target.checked?[...prior,line.id]:prior.filter(id=>id!==line.id))}/> Optional add-on: {line.description}</label> : <strong>{line.description}</strong>}<div className="muted-label">{line.quantity} × {money(line.unitAmountMinor, estimate.currency)}{line.taxable ? " · Taxable" : ""}</div></div>
                <strong className="amount">{line.optional && !selected.includes(line.id) ? "Not included" : money(chosen?.items[estimate.items.filter(item=>!item.optional||selected.includes(item.id)).findIndex(item=>item.id===line.id)]?.totalMinor ?? line.totalMinor, estimate.currency)}</strong>
              </div>)}
            </div> : <p className="subtle">Estimate total: {money(estimate.totalMinor, estimate.currency)}</p>}
            {chosen&&<MoneyTotals pricing={chosen} currency={estimate.currency}/ >}{choiceError&&<p role="alert">{choiceError}</p>}
          </div>
          {estimate.termsText ? <div className="card card-pad"><h2>Terms</h2><p style={{ whiteSpace: "pre-wrap" }}>{estimate.termsText}</p></div> : null}
          <p className="muted-label">Please respond by {new Date(estimate.expiresAt).toLocaleDateString()}.</p>
          {message ? <div className="notice notice-success" role="status">{message}</div> : null}
          {failure && estimate ? <div className="notice notice-error" role="alert">{failure}</div> : null}
          {!message ? <>
            <label className="checkbox-row"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>I have reviewed this estimate and agree to its terms.</span></label>
            <div className="inline-actions">
              <button className="btn btn-primary" disabled={working || !acceptedTerms || !!choiceError} onClick={() => void decide("approve")}>{working ? "Saving…" : "Approve estimate"}</button>
              <button className="btn btn-secondary" disabled={working} onClick={() => void decide("decline")}>Decline</button>
              <button className="btn btn-quiet" type="button" onClick={() => window.print()}>Print</button>
            </div>
          </> : null}
        </div>
      </article> : null}
    </section>
  </main>;
}
