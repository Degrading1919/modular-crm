"use client";
import Link from "next/link";
import { useState } from "react";
import { api, body, date, money } from "./api";
import { Loading, Notice, useResource } from "./ui";

type Plan = { key: string; name: string; seats: number; placeholder?: boolean; prices: Record<string, { monthly: number; yearly?: number }> };
type Billing = { planKey: string; planName: string; status: string; trialDaysLeft: number; trialEnd: string; periodEnd?: string; graceEnd?: string; currency: string; includedSeats: number; nextBill?: number; plans: Plan[]; canManage: boolean; hasSubscription: boolean; mock: boolean };
export function BillingBanner() {
  const result = useResource<{ item?: Billing }>("/platform-billing", {});
  const item = result.data.item;
  if (!item || (item.status === "trialing" && item.trialDaysLeft > 3) || item.status === "active") return null;
  const text = item.status === "trialing" ? `Your free trial ends in ${item.trialDaysLeft} days.` : item.status === "past_due" ? `Your plan payment needs attention. Update billing by ${date(item.graceEnd)} to keep editing.` : "Your workspace is read-only. Your data is safe, and you can still view and export it.";
  return <div className="card card-pad" role="status" style={{ marginBottom: 20 }}><p>{text}</p>{item.canManage ? <Link className="btn btn-primary" href="/app/plan-billing">{item.status === "trialing" ? "Choose a plan" : "Update billing"}</Link> : <p>Ask your business owner to update billing.</p>}</div>;
}
export default function PlanBilling() {
  const result = useResource<{ item?: Billing }>("/platform-billing", {});
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState(""); const [interval, setInterval] = useState<"month" | "year">("month");
  const item = result.data.item;
  async function hosted(purpose: string, planKey?: string) {
    setError(""); setBusy(true);
    try { const response = await api<{ item: { url: string } }>("/platform-billing/hosted", body({ purpose, planKey, currency: currency || item?.currency, interval, idempotencyKey: crypto.randomUUID() })); window.location.assign(response.item.url); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "We couldn’t open billing."); setBusy(false); }
  }
  if (result.loading) return <Loading/>;
  if (result.error || !item) return <Notice kind="error" text={result.error || "Plan details unavailable."}/>;
  const currencies = [...new Set(item.plans.flatMap(plan => Object.keys(plan.prices)))];
  return <><div className="page-head"><div><h1>Plan and billing</h1><p>Your workspace subscription, separate from payments your customers make.</p></div></div>
    {error && <Notice kind="error" text={error}/>}
    <section className="card card-pad"><h2>{item.planName}</h2><p role="status">{item.status === "active" ? "Your plan is active" : item.status === "trialing" ? `${item.trialDaysLeft} days left in your free trial. No card required.` : item.status === "past_due" ? "Payment needs attention" : "Your workspace is read-only"}</p>
      <p>{item.includedSeats} staff seats included. {item.periodEnd ? `Next bill: ${money(item.nextBill, item.currency)} on ${date(item.periodEnd)}.` : `Trial ends ${date(item.trialEnd)}.`}</p>
      <p>Read-only means you can sign in, view records, export all data and update billing. We never delete your data. Customer payment links keep working; new automated messages stop until billing recovers.</p>
      <Link href="/app/import" className="link">Export my data</Link>
      {item.canManage && item.hasSubscription && <div className="page-actions" style={{ marginTop: 20 }}><button className="btn btn-primary" disabled={busy} onClick={() => hosted("portal")}>Change plan</button><button className="btn btn-secondary" disabled={busy} onClick={() => hosted("card")}>Update card</button><button className="btn btn-secondary" disabled={busy} onClick={() => hosted("portal")}>View invoices</button></div>}
    </section>
    {item.canManage && <section className="card card-pad" style={{ marginTop: 20 }}><h2>Choose a plan</h2>{!item.mock && item.status === "trialing" && <p>Your first charge will be no earlier than the trial end. Adding a card near the end may extend your trial to two days from now.</p>}{item.mock && <p>Local demonstration only. Example prices do not charge money.</p>}
      <div className="form-grid"><div className="field"><label htmlFor="plan-currency">Currency</label><select id="plan-currency" value={currency || item.currency} onChange={event => setCurrency(event.target.value)}>{currencies.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="field"><label htmlFor="plan-frequency">Billing frequency</label><select id="plan-frequency" value={interval} onChange={event => setInterval(event.target.value as "month" | "year")}><option value="month">Monthly</option><option value="year">Yearly</option></select></div></div>
      <div className="detail-grid">{item.plans.map(plan => { const price = plan.prices[currency || item.currency]?.[interval === "month" ? "monthly" : "yearly"]; return <article className="card card-pad" key={plan.key}><h3>{plan.name}</h3><p>{price === undefined ? "Not available for this selection" : `${money(price, currency || item.currency)} / ${interval === "month" ? "month" : "year"}`}</p><p>{plan.seats} staff seats</p><button className="btn btn-primary" disabled={busy || price === undefined} onClick={() => hosted(item.hasSubscription ? "portal" : "subscribe", plan.key)}>Choose {plan.name}</button></article>; })}</div>
    </section>}
  </>;
}
export function MockPlanCheckout({ id }: { id: string }) {
  const result = useResource<{ item?: { purpose: string; planName: string; completed: boolean; plans: { key: string; name: string }[] } }>(`/platform-billing/mock/session/${id}`, {});
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [planKey, setPlanKey] = useState("");
  async function finish(action: string) {
    setBusy(true); setError(""); try { await api(`/platform-billing/mock/session/${id}`, body({ action, ...(action === "change" ? { planKey } : {}) })); window.location.assign("/app/plan-billing"); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Could not complete billing."); setBusy(false); }
  }
  return <main className="auth-main"><section className="auth-box"><h1>Secure plan payment</h1><p>Local test page. No card details or real payment.</p>{result.loading ? <Loading/> : result.error ? <Notice kind="error" text={result.error}/> : <><h2>{result.data.item?.planName}</h2><p>{result.data.item?.purpose === "card" ? "Update your test card and pay the outstanding bill." : "Confirm your test plan payment."}</p>{error && <Notice kind="error" text={error}/>}
    <button className="btn btn-primary" disabled={busy || result.data.item?.completed} onClick={() => finish("pay")}>Confirm test payment</button>{result.data.item?.purpose === "portal" && <><div className="field"><label htmlFor="test-plan">New plan</label><select id="test-plan" value={planKey} onChange={event => setPlanKey(event.target.value)}><option value="">Choose a plan</option>{result.data.item.plans.map(plan => <option key={plan.key} value={plan.key}>{plan.name}</option>)}</select></div><button className="btn btn-secondary" disabled={busy || !planKey || result.data.item.completed} onClick={() => finish("change")}>Confirm plan change</button><button className="btn btn-secondary" disabled={busy || result.data.item.completed} onClick={() => finish("cancel")}>Cancel plan</button></>}<p><Link href="/app/plan-billing">Back to billing</Link></p></>}</section></main>;
}
