"use client";
import { useEffect, useState } from "react";
import { defaultInvoiceReminders, invoiceReminderSchedule, type InvoiceReminderSchedule } from "@modular-crm/domain";
import { api, patch } from "./api";
import { Notice, useResource } from "./ui";
import { useWorkspaceAccess } from "./WorkspaceAccess";
import { canUseAction } from "../lib/workspace-access";

export default function InvoiceRemindersSettings() {
  const access = useWorkspaceAccess();
  const settings = useResource<{ item: { overdueReminders?: InvoiceReminderSchedule } }>("/settings", { item: {} });
  const [schedule, setSchedule] = useState(defaultInvoiceReminders), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { if (!settings.loading && !settings.error) setSchedule(invoiceReminderSchedule(settings.data.item.overdueReminders)); }, [settings.loading, settings.error, settings.data.item.overdueReminders]);
  const editable = canUseAction(access, "settings", ["tenant.update"]);
  return <form className="card card-pad" style={{ marginBottom: 16 }} aria-label="Unpaid invoice reminders" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await api("/settings", patch({ overdueReminders: schedule })); setNotice("Invoice reminder settings saved."); settings.reload(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }}>
    <h2>Remind about unpaid invoices</h2><p className="subtle">Email customers after an invoice is due. Reminders stop when it is paid, voided, or marked disputed. Your email preferences and sending limits still apply.</p>
    <label><input type="checkbox" disabled={!editable || busy || settings.loading} checked={schedule.enabled} onChange={event => setSchedule({ ...schedule, enabled: event.target.checked })}/> Remind customers about unpaid invoices</label>
    <div className="form-grid" style={{ marginTop: 16 }}>{([
      ["firstAfterDays", "First reminder, days after due", 90], ["intervalDays", "Days between reminders", 90], ["maxReminders", "Maximum reminders per invoice", 10],
    ] as const).map(([key, label, max]) => <div className="field" key={key}><label htmlFor={`reminders-${key}`}>{label}</label><input id={`reminders-${key}`} type="number" min="1" max={max} required disabled={!editable || busy || !schedule.enabled} value={schedule[key]} onChange={event => setSchedule({ ...schedule, [key]: Number(event.target.value) })}/></div>)}</div>
    {(error || settings.error) && <Notice kind="error" text={error || settings.error}/ >}{notice && <Notice kind="success" text={notice}/ >}
    {editable && <button type="submit" className="btn btn-primary" disabled={busy || settings.loading || !!settings.error}>{busy ? "Saving…" : "Save reminder settings"}</button>}
  </form>;
}
