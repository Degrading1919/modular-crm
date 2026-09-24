"use client";

import { useState, type FormEvent } from "react";
import { api, body, patch, unwrapItem } from "./api";

type TriggerOption = { event: string; label: string; fields: readonly { path: string; label: string; kind: "text" | "number" }[] };
type ConditionDraft = { field: string; operator: string; value: string };
type AutomationActionType = "send_email" | "send_sms" | "create_ticket";

export type AutomationRuleBuilderRule = {
  id: string;
  name: string;
  description?: string;
  trigger?: string;
  triggerConfig?: { event?: string };
  conditions?: unknown;
  actions?: readonly { actionType?: string; configuration?: Record<string, unknown> }[];
  status?: string;
};

export type AutomationRuleBuilderProps = {
  initialRule?: AutomationRuleBuilderRule;
  endpoint?: string;
  onSaved?: (rule: AutomationRuleBuilderRule) => void;
  onCancel?: () => void;
};

const TRIGGERS: readonly TriggerOption[] = [
  { event: "job.completed", label: "A service visit is completed", fields: [
    { path: "job.status", label: "Visit status", kind: "text" }, { path: "job.service_id", label: "Service", kind: "text" },
  ] },
  { event: "invoice.issued", label: "An invoice is sent", fields: [
    { path: "invoice.status", label: "Invoice status", kind: "text" }, { path: "invoice.balanceMinor", label: "Invoice balance (cents)", kind: "number" },
  ] },
  { event: "payment.failed", label: "A payment fails", fields: [
    { path: "payment.status", label: "Payment status", kind: "text" }, { path: "payment.amountMinor", label: "Payment amount (cents)", kind: "number" },
  ] },
  { event: "lead.created", label: "A new customer inquiry arrives", fields: [
    { path: "lead.status", label: "Inquiry status", kind: "text" }, { path: "lead.source", label: "How they found you", kind: "text" },
  ] },
  { event: "customer_change_request.submitted", label: "A customer asks to change service", fields: [
    { path: "request.type", label: "Change requested", kind: "text" },
  ] },
];

const OPERATORS = [
  { value: "equals", label: "is" }, { value: "not_equals", label: "is not" },
  { value: "exists", label: "has a value" }, { value: "not_exists", label: "has no value" },
  { value: "contains", label: "contains" }, { value: "greater_than", label: "is greater than" },
] as const;
const TEXT_OPERATORS = OPERATORS.filter((operator) => operator.value !== "greater_than");

const ACTIONS: readonly { value: AutomationActionType; label: string }[] = [
  { value: "send_email", label: "Send an email to the customer" },
  { value: "send_sms", label: "Send a text message to the customer" },
  { value: "create_ticket", label: "Create an office follow-up" },
];

function triggerFor(event: string) { return TRIGGERS.find((trigger) => trigger.event === event) ?? TRIGGERS[0]!; }
function asText(value: unknown) { return typeof value === "string" ? value : ""; }

function readConditions(value: unknown): ConditionDraft[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const group = value as { all?: unknown[]; field?: unknown; operator?: unknown; value?: unknown };
  const parts = Array.isArray(group.all) ? group.all : [group];
  return parts.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const condition = part as { field?: unknown; operator?: unknown; value?: unknown };
    if (typeof condition.field !== "string" || typeof condition.operator !== "string") return [];
    return [{ field: condition.field, operator: condition.operator, value: condition.value === undefined ? "" : String(condition.value) }];
  });
}

/** Build the small, declarative payload accepted by the tenant automation API. */
export function buildAutomationRulePayload(input: {
  name: string; description: string; trigger: string; conditions: readonly ConditionDraft[];
  action: AutomationActionType; subject: string; message: string; ticketTitle: string; ticketDescription: string; status: "draft" | "active";
}) {
  const numericFields = new Set(triggerFor(input.trigger).fields.filter((field) => field.kind === "number").map((field) => field.path));
  const conditions = input.conditions.filter((condition) => condition.operator === "exists" || condition.operator === "not_exists" || condition.value.trim())
    .map((condition) => ({ field: condition.field, operator: condition.operator, ...(["exists", "not_exists"].includes(condition.operator) ? {} : { value: numericFields.has(condition.field) ? Number(condition.value) : condition.value.trim() }) }));
  let configuration: Record<string, string>;
  if (input.action === "send_email") configuration = { subject: input.subject.trim(), body: input.message.trim() };
  else if (input.action === "send_sms") configuration = { body: input.message.trim() };
  else configuration = { type: "general", title: input.ticketTitle.trim(), description: input.ticketDescription.trim() };
  return {
    name: input.name.trim(), description: input.description.trim() || undefined,
    triggerConfig: { event: input.trigger },
    conditions: conditions.length ? { all: conditions } : {},
    actions: [{ actionType: input.action, configuration }], status: input.status,
  };
}

export default function AutomationRuleBuilder({ initialRule, endpoint = "/automations", onSaved, onCancel }: AutomationRuleBuilderProps) {
  const initialEvent = initialRule?.triggerConfig?.event ?? initialRule?.trigger ?? TRIGGERS[0]!.event;
  const initialAction = ACTIONS.some((option) => option.value === initialRule?.actions?.[0]?.actionType)
    ? initialRule!.actions![0]!.actionType as AutomationActionType : "send_email";
  const initialConfiguration = initialRule?.actions?.[0]?.configuration ?? {};
  const [name, setName] = useState(initialRule?.name ?? "");
  const [description, setDescription] = useState(initialRule?.description ?? "");
  const [trigger, setTrigger] = useState(initialEvent);
  const [conditions, setConditions] = useState<ConditionDraft[]>(readConditions(initialRule?.conditions));
  const [action, setAction] = useState<AutomationActionType>(initialAction);
  const [subject, setSubject] = useState(asText(initialConfiguration.subject));
  const [message, setMessage] = useState(asText(initialConfiguration.body));
  const [ticketTitle, setTicketTitle] = useState(asText(initialConfiguration.title));
  const [ticketDescription, setTicketDescription] = useState(asText(initialConfiguration.description));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedTrigger = triggerFor(trigger);

  function changeTrigger(value: string) {
    const next = triggerFor(value);
    setTrigger(next.event);
    setConditions((current) => current.filter((condition) => next.fields.some((field) => field.path === condition.field)));
  }

  function addCondition() {
    const field = selectedTrigger.fields[0];
    if (field) setConditions((current) => [...current, { field: field.path, operator: "equals", value: "" }]);
  }

  async function save(status: "draft" | "active", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    if (!name.trim()) { setError("Give this rule a name."); return; }
    if ((action === "send_email" || action === "send_sms") && !message.trim()) { setError("Write the message this rule should send."); return; }
    if (action === "send_email" && !subject.trim()) { setError("Add a subject for the email."); return; }
    if (action === "create_ticket" && !ticketTitle.trim()) { setError("Add a title for the office follow-up."); return; }
    setSaving(true);
    try {
      const payload = buildAutomationRulePayload({ name, description, trigger, conditions, action, subject, message, ticketTitle, ticketDescription, status });
      const path = initialRule ? `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(initialRule.id)}` : endpoint;
      const result = await api<{ item: AutomationRuleBuilderRule }>(path, initialRule ? patch(payload) : body(payload));
      onSaved?.(unwrapItem(result));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "This rule could not be saved. Please try again.");
    } finally { setSaving(false); }
  }

  return <form className="stack" onSubmit={(event) => void save("draft", event)}>
    <section className="card card-pad stack" aria-labelledby="automation-trigger-heading">
      <div><p className="eyebrow">Step 1</p><h2 id="automation-trigger-heading">When this happens</h2><p className="subtle">Choose the business moment that should start this rule.</p></div>
      <div className="form-grid">
        <div className="field full"><label htmlFor="automation-name">Rule name</label><input id="automation-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder="For example, follow up after a missed visit" /></div>
        <div className="field full"><label htmlFor="automation-description">What should this rule do? <span className="subtle">(optional)</span></label><input id="automation-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={600} /></div>
        <div className="field full"><label htmlFor="automation-trigger">When this happens</label><select id="automation-trigger" value={trigger} onChange={(event) => changeTrigger(event.target.value)}>{TRIGGERS.map((option) => <option key={option.event} value={option.event}>{option.label}</option>)}</select></div>
      </div>
    </section>

    <section className="card card-pad stack" aria-labelledby="automation-conditions-heading">
      <div><p className="eyebrow">Step 2</p><h2 id="automation-conditions-heading">Only if <span className="subtle">(optional)</span></h2><p className="subtle">Every check you add must match. Leave this empty to run each time.</p></div>
      {conditions.map((condition, index) => {
        const field = selectedTrigger.fields.find((candidate) => candidate.path === condition.field) ?? selectedTrigger.fields[0];
        const operatorNeedsValue = !["exists", "not_exists"].includes(condition.operator);
        const fieldOperators = field?.kind === "number" ? OPERATORS : TEXT_OPERATORS;
        return <div className="form-grid" key={`${index}-${condition.field}`}>
          <div className="field"><label htmlFor={`automation-field-${index}`}>Check</label><select id={`automation-field-${index}`} value={condition.field} onChange={(event) => setConditions((current) => current.map((item, itemIndex) => {
            if (itemIndex !== index) return item;
            const nextField = selectedTrigger.fields.find((candidate) => candidate.path === event.target.value);
            return { ...item, field: event.target.value, operator: nextField?.kind !== "number" && item.operator === "greater_than" ? "equals" : item.operator };
          }))}>{selectedTrigger.fields.map((candidate) => <option key={candidate.path} value={candidate.path}>{candidate.label}</option>)}</select></div>
          <div className="field"><label htmlFor={`automation-operator-${index}`}>Rule</label><select id={`automation-operator-${index}`} value={condition.operator} onChange={(event) => setConditions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value } : item))}>{fieldOperators.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          {operatorNeedsValue && <div className="field"><label htmlFor={`automation-value-${index}`}>Value</label><input id={`automation-value-${index}`} type={field?.kind === "number" ? "number" : "text"} value={condition.value} onChange={(event) => setConditions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} required min={condition.operator === "greater_than" ? "0" : undefined} /></div>}
          <div className="inline-actions"><button type="button" className="btn btn-secondary" aria-label={`Remove check ${index + 1}`} onClick={() => setConditions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove check</button></div>
        </div>;
      })}
      {conditions.length < 5 && <div><button type="button" className="btn btn-secondary" onClick={addCondition}>Add a check</button></div>}
    </section>

    <section className="card card-pad stack" aria-labelledby="automation-action-heading">
      <div><p className="eyebrow">Step 3</p><h2 id="automation-action-heading">Then do this</h2><p className="subtle">Messages go to the customer connected to the event. You can review the rule before turning it on.</p></div>
      <div className="field"><label htmlFor="automation-action">What should happen?</label><select id="automation-action" value={action} onChange={(event) => setAction(event.target.value as AutomationActionType)}>{ACTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
      {(action === "send_email" || action === "send_sms") && <div className="form-grid">
        {action === "send_email" && <div className="field full"><label htmlFor="automation-email-subject">Email subject</label><input id="automation-email-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={180} required /></div>}
        <div className="field full"><label htmlFor="automation-message">{action === "send_email" ? "Email message" : "Text message"}</label><textarea id="automation-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} required placeholder="Write a helpful message for your customer" /></div>
      </div>}
      {action === "create_ticket" && <div className="form-grid">
        <div className="field full"><label htmlFor="automation-ticket-title">Follow-up title</label><input id="automation-ticket-title" value={ticketTitle} onChange={(event) => setTicketTitle(event.target.value)} maxLength={254} required /></div>
        <div className="field full"><label htmlFor="automation-ticket-description">Details for your team <span className="subtle">(optional)</span></label><textarea id="automation-ticket-description" value={ticketDescription} onChange={(event) => setTicketDescription(event.target.value)} maxLength={5000} /></div>
      </div>}
    </section>

    <section className="card card-pad stack" aria-labelledby="automation-review-heading">
      <div><p className="eyebrow">Review</p><h2 id="automation-review-heading">Check your rule</h2><p className="subtle">When {TRIGGERS.find((option) => option.event === trigger)?.label.toLowerCase()}{conditions.length ? ` and ${conditions.length} check${conditions.length === 1 ? "" : "s"} match` : ""}, {ACTIONS.find((option) => option.value === action)?.label.toLowerCase()}.</p><p className="subtle">Turning on a rule lets it act on future matching events. You can pause it later.</p></div>
    </section>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <div className="inline-actions">
      {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>}
      <button type="submit" className="btn btn-secondary" disabled={saving}>{saving ? "Saving…" : "Save draft"}</button>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={(event) => { const form = event.currentTarget.form; if (form?.reportValidity()) void save("active"); }}>Turn on rule</button>
    </div>
  </form>;
}
