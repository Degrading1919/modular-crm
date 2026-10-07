"use client";
import { useState } from "react";
import { useResource, Notice, Loading } from "./ui";
import { date, friendly } from "./api";
export default function PlatformBillingAdmin() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const result = useResource<{ hasNext?: boolean; items?: { tenantId: string; name: string; planKey: string; status: string; trialEnd: string; graceEnd?: string }[] }>(`/platform-admin/billing?page=${page}${status ? `&status=${status}` : ""}`, {});
  return <main className="content"><h1>Business billing</h1><p>Platform operator view. This does not show customer payments.</p><div className="field"><label htmlFor="billing-status">Billing status</label><select id="billing-status" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">All businesses</option>{["trialing", "active", "past_due", "read_only", "canceled"].map(value => <option key={value} value={value}>{friendly(value)}</option>)}</select></div>
    {result.loading ? <Loading/> : result.error ? <Notice kind="error" text={result.error}/> : <table><thead><tr><th>Business</th><th>Plan</th><th>Status</th><th>Trial end</th><th>Grace ends</th></tr></thead><tbody>{result.data.items?.map(item => <tr key={item.tenantId}><td>{item.name}</td><td>{item.planKey}</td><td>{friendly(item.status)}</td><td>{date(item.trialEnd)}</td><td>{date(item.graceEnd)}</td></tr>)}</tbody></table>}
    <div className="page-actions"><button className="btn btn-secondary" disabled={page === 0 || result.loading} onClick={() => setPage(page - 1)}>Previous businesses</button><button className="btn btn-secondary" disabled={!result.data.hasNext || result.loading} onClick={() => setPage(page + 1)}>More businesses</button></div>
  </main>;
}
