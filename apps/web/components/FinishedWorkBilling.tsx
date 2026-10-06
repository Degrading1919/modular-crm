"use client";
import { useEffect, useRef, useState } from "react";
import { api, body, money } from "./api";
import { Loading, Notice, useResource } from "./ui";
import { useWorkspaceAccess } from "./WorkspaceAccess";
import { canUseAction } from "../lib/workspace-access";

type CustomerWork = { customerId: string; name: string; visits: number; invoiceCount: number; totals: Record<string, number>; error?: string };
type Preview = { from: string; through: string; scope: string; items: CustomerWork[] };
export default function FinishedWorkBilling({ onDone }: { onDone: () => void }) {
  const access = useWorkspaceAccess();
  const [open, setOpen] = useState(false), [from, setFrom] = useState(""), [through, setThrough] = useState("");
  const [range, setRange] = useState(""), [issue, setIssue] = useState(false), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]), [progress, setProgress] = useState(""), [summary, setSummary] = useState(""), [errors, setErrors] = useState<string[]>([]);
  const keys = useRef<Record<string, string>>({});
  const preview = useResource<Preview>(open ? `/billing/finished-work${range}` : null, { from: "", through: "", scope: "", items: [] });
  useEffect(() => {
    if (!preview.loading && !preview.error && preview.data.from) {
      setFrom(preview.data.from); setThrough(preview.data.through); setSelected(preview.data.items.filter(row => !row.error).map(row => row.customerId));
    }
  }, [preview.loading, preview.error, preview.data]);
  if (!canUseAction(access, "invoices", ["invoices.create", "invoices.read", "jobs.read"])) return null;
  const work = preview.data.items.filter(row => selected.includes(row.customerId));
  const count = work.reduce((total, row) => total + row.invoiceCount, 0);
  async function create() {
    setBusy(true); setErrors([]); setSummary("");
    let created = 0, visits = 0; const failed = [];
    for (const [index, row] of work.entries()) {
      setProgress(`Billing customer ${index + 1} of ${work.length}: ${row.name}`);
      const command = `${preview.data.from}:${preview.data.through}:${row.customerId}:${issue}`;
      keys.current[command] ??= crypto.randomUUID();
      try {
        const result = await api<{ created: number; visits: number }>("/billing/finished-work", body({ from: preview.data.from, through: preview.data.through, customerId: row.customerId, issue, idempotencyKey: keys.current[command] }));
        created += result.created; visits += result.visits;
      } catch (cause) { failed.push(`${row.name}: ${(cause as Error).message}`); }
    }
    setErrors(failed); setProgress(""); setSummary(`Created ${created} ${issue ? "issued" : "draft"} invoices for ${visits} visits.${failed.length ? ` ${failed.length} customers need review.` : ""}`); setBusy(false); onDone();
    if (!failed.length) { keys.current = {}; preview.reload(); }
  }
  return <section className="card card-pad" style={{ marginBottom: 16 }} aria-label="Bill finished work">
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setOpen(!open)}>Bill finished work</button>
    {open && <div className="stack" style={{ marginTop: 16 }}>
      <p className="subtle">{preview.data.scope || "Review completed work that has not been invoiced. The starting range is last month."}</p>
      <form className="form-grid" onSubmit={event => { event.preventDefault(); keys.current = {}; setRange(`?from=${from}&through=${through}`); preview.reload(); }}>
        <div className="field"><label htmlFor="billing-from">Completed from</label><input id="billing-from" type="date" required value={from} disabled={busy} onChange={event => setFrom(event.target.value)}/></div>
        <div className="field"><label htmlFor="billing-through">Completed through</label><input id="billing-through" type="date" required min={from} value={through} disabled={busy} onChange={event => setThrough(event.target.value)}/></div>
        <button className="btn btn-secondary" disabled={busy || !from || !through} type="submit">Preview work</button>
      </form>
      {preview.error && <Notice kind="error" text={preview.error}/ >}
      {preview.loading ? <Loading label="Reviewing finished work…"/> : preview.data.items.length ? preview.data.items.map(row => <div className="action-item" key={row.customerId}>
        <label><input type="checkbox" disabled={busy || !!row.error} checked={selected.includes(row.customerId)} onChange={event => setSelected(previous => event.target.checked ? [...previous, row.customerId] : previous.filter(id => id !== row.customerId))}/> {row.name}</label>
        <div><p>{row.visits} visits · {Object.entries(row.totals).map(([currency, total]) => money(total, currency)).join(" + ")} · {row.invoiceCount} invoices</p>{row.error && <Notice kind="error" text={row.error}/>}</div>
      </div>) : <p>No uninvoiced completed work in this date range.</p>}
      {access.permissions.includes("invoices.issue") && <label><input type="checkbox" disabled={busy} checked={issue} onChange={event => setIssue(event.target.checked)}/> Issue invoices now instead of saving drafts</label>}
      <button type="button" className="btn btn-primary" disabled={busy || preview.loading || !!preview.error || count === 0 || from !== preview.data.from || through !== preview.data.through} onClick={() => void create()}>{busy ? "Creating invoices…" : `Create ${count} invoices`}</button>
      <div role="status" aria-label="Billing progress">{progress || summary}</div>{errors.map(error => <Notice key={error} kind="error" text={error}/ >)}
    </div>}
  </section>;
}
