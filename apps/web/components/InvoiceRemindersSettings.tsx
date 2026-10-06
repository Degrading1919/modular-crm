"use client";
import { useEffect, useState } from "react";
import { businessPaymentDueDays, paymentDueOptions, defaultInvoiceReminders, invoiceReminderSchedule, type InvoiceReminderSchedule } from "@modular-crm/domain";
import { api, patch } from "./api";
import { Notice, useResource } from "./ui";
import { useWorkspaceAccess } from "./WorkspaceAccess";
import { canUseAction } from "../lib/workspace-access";

export default function InvoiceRemindersSettings() {
  const access = useWorkspaceAccess();
  const settings = useResource<{ item: { paymentDueDays?: number; overdueReminders?: InvoiceReminderSchedule } }>("/settings", { item: {} });
  const [paymentDueDays, setPaymentDueDays] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [schedule, setSchedule] = useState(defaultInvoiceReminders), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { if (!initialized && !settings.loading && !settings.error) { setSchedule(invoiceReminderSchedule(settings.data.item.overdueReminders)); setPaymentDueDays(businessPaymentDueDays(settings.data.item.paymentDueDays)); setInitialized(true); } }, [initialized, settings.loading, settings.error, settings.data.item.overdueReminders, settings.data.item.paymentDueDays]);
  const editable = canUseAction(access, "settings", ["tenant.update"]);
  return <form className="card card-pad" style={{ marginBottom: 16 }} aria-label="Unpaid invoice reminders" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await api("/settings", patch({ paymentDueDays, overdueReminders: schedule })); setNotice("Invoice payment and reminder settings saved."); settings.reload(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }}>
    <h2>Invoice payment and reminders</h2>
    <div className="field"><label htmlFor="invoice-payment-due">Payment due</label><select id="invoice-payment-due" disabled={!editable || busy || settings.loading || !initialized} value={paymentDueDays} onChange={event => setPaymentDueDays(Number(event.target.value))}>{paymentDueOptions.map(days => <option key={days} value={days}>{days === 0 ? "On receipt" : `${days} days after issue`}</option>)}</select></div>
    <p className="subtle">Applies to newly issued invoices for this business. Agreed customer or plan terms and a due date you entered take priority. Existing issued invoices stay unchanged.</p>
    <h3>Remind about unpaid invoices</h3><p className="subtle">Email customers after an invoice is due. Reminders stop when it is paid, voided, or marked disputed. Your email preferences and sending limits still apply.</p>
    <label><input type="checkbox" disabled={!editable || busy || settings.loading || !initialized} checked={schedule.enabled} onChange={event => setSchedule({ ...schedule, enabled: event.target.checked })}/> Remind customers about unpaid invoices</label>
    <div className="form-grid" style={{ marginTop: 16 }}>{([
      ["firstAfterDays", "First reminder, days after due", 90], ["intervalDays", "Days between reminders", 90], ["maxReminders", "Maximum reminders per invoice", 10],
    ] as const).map(([key, label, max]) => <div className="field" key={key}><label htmlFor={`reminders-${key}`}>{label}</label><input id={`reminders-${key}`} type="number" min="1" max={max} required disabled={!editable || busy || !schedule.enabled} value={schedule[key]} onChange={event => setSchedule({ ...schedule, [key]: Number(event.target.value) })}/></div>)}</div>
    {(error || settings.error) && <Notice kind="error" text={error || settings.error}/ >}{notice && <Notice kind="success" text={notice}/ >}
    {editable && <button type="submit" className="btn btn-primary" disabled={busy || settings.loading || !initialized || !!settings.error}>{busy ? "Saving…" : "Save invoice settings"}</button>}
  </form>;
}
