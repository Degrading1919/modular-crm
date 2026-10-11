"use client";
import { useState } from "react";
import { api, body, patch } from "./api";
import { Modal, Notice } from "./ui";
import { PackFields } from "./PackFields";

export default function CustomerRecordEditor({ customer, onDone }: { customer: Record<string, any> & { id: string }; onDone: () => void }) {
  const [section, setSection] = useState<"properties" | "contacts" | "notes" | null>(null);
  const [current, setCurrent] = useState<Record<string, any> | null>(null);
  const [values, setValues] = useState<Record<string, any>>({}), [fields, setFields] = useState<Record<string, unknown>>({});
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  function open(kind: NonNullable<typeof section>, item: Record<string, any> | null = null) {
    setSection(kind); setCurrent(item); setValues(item ?? {}); setFields(item?.fieldValues ?? {}); setError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const keys = section === "properties" ? ["name", "addressLine1", "addressLine2", "city", "region", "postalCode", "countryCode"] : section === "contacts" ? ["firstName", "lastName", "email", "phone"] : ["body"];
      const input = Object.fromEntries(keys.map(key => [key, values[key] ?? (key === "countryCode" ? "US" : "")]));
      if (section === "properties") input.locationFields = fields;
      if (section === "contacts") { input.billingContact = !!values.billingContact; input.serviceContact = values.serviceContact !== false; }
      if (current) input.expectedUpdatedAt = new Date(current.updatedAt).toISOString();
      await api(`/customers/${customer.id}/${section}${current ? `/${current.id}` : ""}`, current ? patch(input) : body(input));
      setSection(null); onDone();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  const inputs = section === "properties" ? [["Property name", "name"], ["Street address", "addressLine1"], ["Address line 2", "addressLine2"], ["City", "city"], ["State or region", "region"], ["Postal code", "postalCode"], ["Country code", "countryCode"]] : [["First name", "firstName"], ["Last name", "lastName"], ["Email", "email"], ["Phone", "phone"]];
  return <section className="card card-pad" aria-label="Manage customer details"><h2>Manage customer details</h2><div className="inline-actions"><button className="btn btn-secondary" onClick={() => open("properties")}>Add service property</button><button className="btn btn-secondary" onClick={() => open("contacts")}>Add contact</button><button className="btn btn-secondary" onClick={() => open("notes")}>Add customer note</button></div>
    {customer.locations?.map((item: Record<string, any>) => <div className="action-item" key={item.id}><span>{item.name} · {item.addressLine1}</span><button className="btn btn-secondary" onClick={() => open("properties", item)}>Edit property</button></div>)}
    {customer.contacts?.map((item: Record<string, any>) => <div className="action-item" key={item.id}><span>{item.firstName} {item.lastName}</span><button className="btn btn-secondary" onClick={() => open("contacts", item)}>Edit contact</button></div>)}
    {section && <Modal title={section === "notes" ? "Add customer note" : `${current ? "Edit" : "Add"} ${section === "properties" ? "service property" : "contact"}`} onClose={() => !busy && setSection(null)}><form onSubmit={save}>
      {section === "notes" ? <label className="field">Office note<textarea required maxLength={10_000} value={values.body ?? ""} onChange={e => setValues({ ...values, body: e.target.value })}/></label> : inputs.map(([label, key]) => <label className="field" key={key}>{label}<input type={key === "email" ? "email" : "text"} required={section === "properties" ? key !== "addressLine2" : key === "firstName"} maxLength={200} value={values[key] ?? (key === "countryCode" ? "US" : "")} onChange={e => setValues({ ...values, [key]: e.target.value })}/></label>)}
      {section === "properties" && <><h3>Property service details</h3><p>Private access fields are write-only. Leave them blank to keep existing instructions.</p><PackFields fields={(customer.pack?.locationFields ?? []).filter((field: { type: string }) => field.type !== "media")} values={fields} onChange={(key, value) => setFields({ ...fields, [key]: value })}/></>}
      {section === "contacts" && <><label><input type="checkbox" checked={!!values.billingContact} onChange={e => setValues({ ...values, billingContact: e.target.checked })}/> Billing contact</label><label><input type="checkbox" checked={values.serviceContact !== false} onChange={e => setValues({ ...values, serviceContact: e.target.checked })}/> Service contact</label></>}
      {error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setSection(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
    </form></Modal>}
  </section>;
}
