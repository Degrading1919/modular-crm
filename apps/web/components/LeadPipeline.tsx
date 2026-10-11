"use client";
import { useState } from "react";
import { allowedTransitions } from "@modular-crm/domain";
import { api, body, friendly } from "./api";
import { Notice } from "./ui";
import { DocumentEditor } from "./DocumentEditor";
import { useRouter } from "next/navigation";

export default function LeadPipeline({ lead, canUpdate, canEstimate, onDone }: { lead: Record<string, any> & { id: string }; canUpdate: boolean; canEstimate: boolean; onDone: () => void }) {
  const [status, setStatus] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [estimate, setEstimate] = useState(false);
  const router = useRouter();
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`/leads/${lead.id}/status`, body({ status, expectedUpdatedAt: lead.updatedAt, ...(["lost", "disqualified"].includes(status) ? { reason } : {}) })); setStatus(""); setReason(""); onDone(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  const transitions = allowedTransitions("lead", lead.status).filter(value => value !== "converted");
  return <section className="card card-pad" aria-label="Lead pipeline"><h2>Lead pipeline</h2><p>Won leads become customers. Keep lost reasons in the history.</p>
    {lead.customFields?.websiteMessage && <><h3>Website message</h3><p style={{ whiteSpace: "pre-wrap" }}>{lead.customFields.websiteMessage}</p></>}{lead.customFields?.notes && <p>{lead.customFields.notes}</p>}
    {canUpdate && !!transitions.length && <form onSubmit={save}><label className="field">Next stage<select required value={status} onChange={event => setStatus(event.target.value)}><option value="">Choose a stage</option>{transitions.map(value => <option key={value} value={value}>{friendly(value)}</option>)}</select></label>{["lost", "disqualified"].includes(status) && <label className="field">Reason<textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)}/></label>}<button className="btn btn-secondary" disabled={busy}>Update stage</button></form>}
    {canEstimate && <button className="btn btn-primary" onClick={() => setEstimate(true)}>Create estimate from lead</button>}{error && <Notice kind="error" text={error}/>}
    {estimate && <DocumentEditor kind="estimate" lead={lead} onClose={() => setEstimate(false)} onSaved={item => router.push(`/app/estimates/${item.id}`)}/>}
  </section>;
}
