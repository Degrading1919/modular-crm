"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { allowedTransitions, paymentMethodLabel, type Permission } from "@modular-crm/domain";
import { api, body, date, money, patch } from "./api";
import { Badge, Loading, Modal, Notice, useResource } from "./ui";
import { WorkspaceLink as Link, useWorkspaceAccess } from "./WorkspaceAccess";
import { canUseAction } from "../lib/workspace-access";
import { paymentReceiptDestination } from "../lib/resource-navigation";
import InvoiceRefund, { type RefundPaymentContext } from "./InvoiceRefund";
import InvoicePaymentAttention from "./InvoicePaymentAttention";
import ManualPaymentForm from "./ManualPaymentForm";
import CustomerPortalAccess from "./CustomerPortalAccess";
import { DocumentEditor, MoneyTotals } from "./DocumentEditor";
import "./record-detail.css";

type Row = Record<string, any> & { id: string };
function ReceiptLink({ payment }: { payment: Row }) {
  const destination = paymentReceiptDestination(payment);
  return destination ? <Link href={destination.href}>{destination.label}</Link> : null;
}
type Detail = { item: Row; related: Record<string, Row[]>; timeline: { id: string; title: string; description?: string; occurredAt: string }[] };
const labels: Record<string, string> = { customers: "Customer", jobs: "Job", invoices: "Invoice", leads: "Lead" };
const edits: Record<string, { label: string; key: string; type?: string; required?: boolean }[]> = {
  customers: [{ label: "Name", key: "name", required: true }, { label: "Email", key: "email", type: "email" }, { label: "Phone", key: "phone", type: "tel" }],
  leads: [{ label: "Email", key: "email", type: "email" }, { label: "Phone", key: "phone", type: "tel" }, { label: "Source", key: "source" }],
  jobs: [{ label: "Office notes", key: "notes", type: "textarea" }, { label: "Customer summary", key: "customerSummary", type: "textarea" }],
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card card-pad" aria-label={title}><h2>{title}</h2>{children}</section>;
}
function Header({ title, subtitle, eyebrow, children }: { title: string; subtitle: string; eyebrow?: string; children?: ReactNode }) {
  return <header className="page-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{subtitle}</p></div><div className="inline-actions">{children}</div></header>;
}
function Collection({ items, empty, render }: { items?: Row[]; empty: string; render: (row: Row) => ReactNode }) {
  return items?.length ? <div className="stack">{items.map((row) => <div key={row.id} className="action-item">{render(row)}</div>)}</div> : <p className="subtle">{empty}</p>;
}

export default function RecordDetail({ resource, id }: { resource: string; id: string }) {
  const router = useRouter();
  const access = useWorkspaceAccess();
  const detail = useResource<Detail>(`/${resource}/${id}/detail`, { item: { id: "" }, related: {}, timeline: [] });
  const staff = useResource<{ items: Row[] }>(resource === "jobs" && access.permissions.includes("staff.read") ? "/staff" : null, { items: [] });
  const { item, related, timeline } = detail.data;
  const [panel, setPanel] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const retry = useRef("");
  const may = (permission: Permission, feature?: string) => canUseAction(access, resource, [permission], feature);
  const editable = resource === "invoices" ? may("invoices.adjust") && item.status === "draft" && !(item.billingSnapshot?.jobIds?.length > 1) : may(`${resource}.update` as Permission);
  const plannable = ["draft", "unscheduled", "scheduled", "dispatched", "missed"].includes(item.status);
  const payments = (related.payments ?? []) as unknown as RefundPaymentContext[];
  function open(name: string) {
    retry.current = ""; setError(""); setPanel(name);
    setValues({ ...Object.fromEntries((edits[resource] ?? []).map((field) => [field.key, String(item[field.key] ?? "")])), notes: item.internalSummary ?? "", scheduledDate: item.scheduledDate ?? "", description: related.lines?.[0]?.description ?? "", amount: (Number(item.totalCents ?? 0) / 100).toFixed(2), dueDate: String(item.dueDate ?? "").slice(0, 10), technicianId: "", reason: "" });
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      if (panel === "edit") {
        const changes: Record<string, unknown> = Object.fromEntries(edits[resource].map((field) => [field.key, values[field.key] ?? ""]));
        await api(`/${resource}/${id}`, patch(changes));
      } else {
        if (!retry.current) retry.current = crypto.randomUUID();
        await api(`/jobs/${id}/${panel}`, body({ idempotencyKey: retry.current, expectedUpdatedAt: item.updatedAt, ...(panel === "reschedule" ? { scheduledDate: values.scheduledDate } : panel === "reassign" ? { technicianId: values.technicianId } : { reason: values.reason }) }));
      }
      setPanel(null); retry.current = ""; setNotice(panel === "cancel" ? "Job canceled. The reason is recorded in its history." : panel === "reschedule" || panel === "reassign" ? "Job updated. Publish its route when the schedule is ready." : "Changes saved."); detail.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t save this change. Please try again."); }
    finally { setSaving(false); }
  }
  async function primary(action: string) {
    setSaving(true); setError("");
    try { const result=await api<{item?:Row}>(`/${resource}/${id}/${action}`, body({})); if(action==="invoice"&&result.item?.id){router.push(`/app/invoices/${result.item.id}`);return;} detail.reload(); setNotice(action === "issue" ? "Invoice issued." : "Lead converted to a customer."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t complete this action."); }
    finally { setSaving(false); }
  }
  if (detail.loading) return <Loading label="Loading record…"/>;
  if (detail.error || !item.id) return <><Header title={`${labels[resource]} unavailable`} subtitle="Refresh this page or return to the list."/><Notice kind="error" text={detail.error || "This record is unavailable."}/><Link className="btn btn-secondary" href={`/app/${resource}`}>Back to list</Link></>;
  const title = item.name || item.number || item.customerName || labels[resource];
  const facts = resource === "customers" ? [["Email", item.email || "Not recorded"], ["Phone", item.phone || "Not recorded"], ["Next service", date(item.nextService)]] : resource === "jobs" ? [["Service", item.serviceName], ["Service date", date(item.scheduledDate)], ["Technician", item.technicianName || "Not assigned"], ["Service address", item.address]] : resource === "invoices" ? [["Customer", item.customerName], ["Business location", `${item.organizationName || ""} · ${item.locationName || "Unassigned"}`], ["Total", money(item.totalCents, item.currency)], ["Balance", money(item.balanceCents, item.currency)], ["Due date", item.dueDate ? date(item.dueDate) : "Not set"]] : [["Email", item.email || "Not recorded"], ["Phone", item.phone || "Not recorded"], ["Source", item.source || "Not recorded"]];
  return <>
    <Header eyebrow={labels[resource]} title={title} subtitle="Details, related work and history in one place."><Link href={`/app/${resource}`} className="btn btn-secondary">Back to {resource}</Link></Header>
    {error && <Notice kind="error" text={error}/ >}{notice && <Notice kind="success" text={notice}/ >}
    <section className="card card-pad record-summary" aria-label="Record summary"><div className="card-heading"><h2>{labels[resource]} details</h2><Badge status={item.status}/></div><dl className="record-facts">{facts.map(([label, value]) => <div className="detail-list" key={label}><dt>{label}</dt><dd>{value || "Not recorded"}</dd></div>)}</dl><div className="inline-actions">
      {editable && <button className="btn btn-secondary" onClick={() => open("edit")}>Edit {labels[resource].toLowerCase()}</button>}
      {resource === "customers" && <Link className="btn btn-secondary" href={`/app/documents/statement/${id}`}>Create account statement</Link>}
      {resource === "jobs" && item.status === "completed" && <Link className="btn btn-secondary" href={`/app/documents/completion/${id}`}>View completion report</Link>}
      {resource === "jobs" && item.status === "completed" && !item.servicePlanId && canUseAction(access,"invoices",["invoices.create","invoices.read"]) && <button className="btn btn-primary" disabled={saving} onClick={()=>void primary("invoice")}>Create invoice</button>}
      {resource === "jobs" && plannable && may("jobs.assign", "service_scheduling") && <button className="btn btn-primary" onClick={() => open("reschedule")}>Reschedule</button>}
      {resource === "jobs" && plannable && may("jobs.assign", "service_scheduling") && access.permissions.includes("staff.read") && <button className="btn btn-secondary" onClick={() => open("reassign")}>Reassign</button>}
      {resource === "jobs" && allowedTransitions("job", item.status).includes("canceled") && may("jobs.cancel", "service_scheduling") && <button className="btn btn-secondary" onClick={() => open("cancel")}>Cancel job</button>}
      {resource === "invoices" && item.status === "draft" && may("invoices.issue") && <button className="btn btn-primary" disabled={saving} onClick={() => void primary("issue")}>Issue invoice</button>}
      {resource === "invoices" && Number(item.openBalanceCents) > 0 && may("payments.record_manual", "payment_collection") && access.permissions.includes("payments.collect") && <button className="btn btn-primary" onClick={() => open("payment")}>Record payment</button>}
      {resource === "invoices" && <Link className="btn btn-secondary" href={`/app/documents/invoice/${id}`}>View invoice</Link>}
      {resource === "leads" && item.status !== "converted" && may("leads.convert") && <button className="btn btn-primary" disabled={saving} onClick={() => void primary("convert")}>Convert to customer</button>}
    </div></section>
    {resource === "invoices" && <InvoicePaymentAttention amountCents={Number(item.overpaymentCents)} currency={item.currency} canRefund={access.role === "owner" && may("payments.refund", "payment_collection")}/>}
    <div className="record-detail-grid"><main className="stack">
      {resource === "customers" && <>
        <Section title="Properties"><Collection items={item.locations} empty="No service properties recorded." render={(row) => <div><strong>{row.name || "Service property"}</strong><p>{[row.addressLine1, row.city, row.region, row.postalCode].filter(Boolean).join(", ")}</p></div>}/></Section>
        <Section title="Contacts"><Collection items={item.contacts} empty="No additional contacts recorded." render={(row) => <div><strong>{[row.firstName,row.lastName].filter(Boolean).join(" ") || "Contact"}</strong><p>{[row.email,row.phone].filter(Boolean).join(" · ") || "No contact details recorded"}</p></div>}/></Section>
        <Section title="Pets & service details"><Collection items={item.pets} empty="No pets or service details recorded." render={(row) => <div><strong>{row.name}</strong><p>{row.customFields?.size || row.customFields?.species || "Pet"}{row.customFields?.safetyFlag ? ` · Safety: ${row.customFields.safetyFlag}` : ""}</p></div>}/></Section>
        {related.jobs && <Section title="Jobs"><Collection items={related.jobs} empty="No jobs in your business locations." render={(row) => <Link href={`/app/jobs/${row.id}`}>{row.serviceName} · {date(row.scheduledDate)} <Badge status={row.status}/></Link>}/></Section>}
        {related.invoices && <Section title="Invoices"><Collection items={related.invoices} empty="No invoices in your business locations." render={(row) => <Link href={`/app/invoices/${row.id}`}>{row.number} · {money(row.totalCents, row.currency)} · Balance {money(row.balanceCents, row.currency)} <Badge status={row.status}/></Link>}/></Section>}
        {related.payments && <Section title="Payments"><Collection items={related.payments} empty="No payments in your business locations." render={(row) => <div>{money(row.amountCents, row.currency)} · {paymentMethodLabel(row.method)} <Badge status={row.status}/><ReceiptLink payment={row}/></div>}/></Section>}
        {may("customers.update") && <CustomerPortalAccess customerId={id} email={item.email} locations={item.locations || []}/>}
      </>}
      {resource === "jobs" && <>
        <Section title="Visits"><p>Current service day: {date(item.scheduledDate)}</p><Collection items={related.visits} empty="No appointment windows recorded." render={(row) => <div>{date(row.startsAt || row.windowStart)} <Badge status={row.status}/></div>}/><Collection items={related.routeHistory} empty="No route history in your business locations." render={(row) => <div>Route on {date(row.routeDate)} · {row.status === "removed" ? "Removed after a schedule or assignment change" : <Badge status={row.status}/>}</div>}/></Section>
        <Section title="Notes"><p>{item.internalSummary || "No office notes recorded."}</p><Collection items={related.notes} empty="No visit notes recorded." render={(row) => <div><p>{row.body}</p><span className="subtle">{date(row.createdAt)}</span></div>}/></Section>
        <Section title="Photos"><Collection items={related.photos} empty="No photos recorded." render={(row) => <a className="link" href={`/api/v1/files/${row.id}/download`} target="_blank" rel="noreferrer">{row.originalName}</a>}/></Section>
      </>}
      {resource === "invoices" && <>
        <Section title="Price breakdown"><MoneyTotals pricing={{subtotalMinor:Number(item.subtotalMinor),discountMinor:Number(item.discountMinor),taxMinor:Number(item.taxMinor),totalMinor:Number(item.totalMinor)}} currency={item.currency}/></Section>
        <Section title="Invoice lines"><Collection items={related.lines} empty="No invoice lines recorded." render={(row) => <div><strong>{row.description}</strong><p>{row.quantity} × {money(row.unitCents, item.currency)} · {money(row.totalCents, item.currency)}</p></div>}/></Section>
        {related.payments && <Section title="Payment history"><Collection items={related.payments} empty="No payments have been recorded for this invoice." render={(row) => <div><strong>{money(row.amountCents, item.currency)}</strong><p>{paymentMethodLabel(row.method, row.sourceType)}{row.reference ? ` · Reference: ${row.reference}` : ""} · {date(row.createdAt)}</p><Badge status={row.status}/><p>Refunded {money(row.refundedCents, item.currency)}</p><ReceiptLink payment={row}/></div>}/>{may("payments.refund", "payment_collection") && <InvoiceRefund invoiceId={id} balanceCents={Number(item.balanceCents)} currency={item.currency} payments={payments.filter((payment) => payment.method !== "card" || access.role === "owner")} onRefunded={() => detail.reload()}/>}</Section>}
        {related.refunds && <Section title="Refunds"><Collection items={related.refunds} empty="No refunds recorded." render={(row) => <div>{money(row.amountCents, row.currency)} <Badge status={row.status}/><p>{row.reason || "No reason recorded"}</p></div>}/></Section>}
      </>}
      {resource === "leads" && <Section title="Related customer"><Collection items={related.customer} empty="This lead has not been linked to an accessible customer." render={(row) => <Link href={`/app/customers/${row.id}`}>{row.name}</Link>}/></Section>}
    </main><aside className="stack"><Section title="History"><Collection items={timeline as Row[]} empty="No activity has been recorded yet." render={(row) => <div><strong>{row.title}</strong><p>{row.description}</p><time dateTime={row.occurredAt}>{date(row.occurredAt, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>}/><p className="subtle">Showing the latest 100 activities. Related lists show recent records in your permitted business locations.</p></Section></aside></div>
    {panel === "edit" && resource === "invoices" ? <DocumentEditor kind="invoice" record={{...item,lines:related.lines}} onClose={()=>setPanel(null)} onSaved={()=>{setPanel(null);detail.reload();setNotice("Changes saved.");}}/> : panel && <Modal title={panel === "edit" ? `Edit ${labels[resource].toLowerCase()}` : panel === "payment" ? "Record a payment" : panel === "cancel" ? "Cancel job" : panel === "reassign" ? "Reassign job" : "Reschedule job"} onClose={() => { if (!saving) setPanel(null); }}>
      {panel === "payment" ? <ManualPaymentForm invoice={item} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); detail.reload(); setNotice("Payment recorded."); }}/> : <form onSubmit={submit}>
        {panel === "edit" ? edits[resource].map((field) => <label className="field" key={field.key}>{field.label}{field.type === "textarea" ? <textarea value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}/> : <input type={field.type || "text"} min={field.type === "number" ? "0" : undefined} step={field.type === "number" ? ".01" : undefined} minLength={field.key === "name" ? 2 : undefined} value={values[field.key] ?? ""} required={field.required} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}/>}</label>) : panel === "reschedule" ? <><p>This removes the job from its previous route. Publish a route for the new date when ready.</p><label className="field">New service date<input type="date" required value={values.scheduledDate} onChange={(event) => setValues({ ...values, scheduledDate: event.target.value })}/></label></> : panel === "reassign" ? <><p>The job returns to scheduling so the new technician receives it on a published route.</p><label className="field">Technician<select required value={values.technicianId} onChange={(event) => setValues({ ...values, technicianId: event.target.value })}><option value="">Choose a technician</option>{staff.data.items.filter((person) => person.role === "technician" && person.status === "active" && person.locationIds?.includes(item.organizationLocationId)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>{staff.error && <Notice kind="error" text={staff.error}/>}</> : <><p>The job will not be performed. Its history remains, and any configured cancellation notification follows your business settings.</p><label className="field">Cancellation reason<textarea required maxLength={500} value={values.reason} onChange={(event) => setValues({ ...values, reason: event.target.value })}/></label></>}
        {error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button className="btn btn-secondary" type="button" disabled={saving} onClick={() => setPanel(null)}>Keep unchanged</button><button className="btn btn-primary" disabled={saving} type="submit">{saving ? "Saving…" : panel === "cancel" ? "Confirm cancellation" : "Save changes"}</button></div>
      </form>}
    </Modal>}
  </>;
}
