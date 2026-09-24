import { evaluateConditions, resolvePath, type Condition } from "@modular-crm/config";

export type AutomationActionType =
  | "send_email" | "send_sms" | "create_ticket" | "update_ticket" | "create_job" | "reschedule_job"
  | "create_invoice" | "issue_invoice" | "attempt_payment" | "add_customer_tag" | "remove_customer_tag"
  | "update_customer_status" | "update_custom_field" | "add_note" | "notify_staff"
  | "pause_service_plan" | "resume_service_plan" | "invoke_connector_action" | "enqueue_followup_automation";
export type ActionDelay = { afterEventMinutes: number } | { relativeToField: string; offsetMinutes: number };
export type AutomationAction = Readonly<{
  actionType: AutomationActionType;
  configuration: Record<string, unknown>;
  delay?: ActionDelay;
  continueOnError?: boolean;
  dedupeKeyTemplate?: string;
}>;
export type AutomationRule = Readonly<{
  id: string;
  tenantId: string;
  version: number;
  name: string;
  description?: string;
  source: "core_recipe" | "industry_pack" | "tenant";
  status: "active" | "inactive";
  trigger: { event: string; filters?: Condition };
  conditions?: Condition;
  actions: readonly AutomationAction[];
  recheckConditions?: boolean;
}>;
export type DomainEvent = Readonly<{
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  tenantId: string;
  organizationId?: string;
  locationId?: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  causationId?: string;
  chainDepth?: number;
  payload: Record<string, unknown>;
}>;
export type PlannedAction = Readonly<{ index: number; executionKey: string; scheduledAt: string; action: AutomationAction }>;
export type AutomationPlan = Readonly<{ runKey: string; ruleId: string; ruleVersion: number; tenantId: string; eventId: string; correlationId: string; actions: readonly PlannedAction[] }>;
export type AutomationEvaluation = Readonly<{ matched: boolean; reason?: string }>;

export const MAX_EVENT_CHAIN_DEPTH = 8;
const ACTION_TYPES = new Set<AutomationActionType>([
  "send_email", "send_sms", "create_ticket", "update_ticket", "create_job", "reschedule_job", "create_invoice", "issue_invoice", "attempt_payment", "add_customer_tag", "remove_customer_tag", "update_customer_status", "update_custom_field", "add_note", "notify_staff", "pause_service_plan", "resume_service_plan", "invoke_connector_action", "enqueue_followup_automation",
]);
const OBVIOUS_EVENTS: Partial<Record<AutomationActionType, string>> = { create_ticket: "ticket.created", create_job: "job.created", create_invoice: "invoice.created", issue_invoice: "invoice.issued", pause_service_plan: "service_plan.paused", resume_service_plan: "service_plan.resumed" };

export function automationRunKey(event: DomainEvent, rule: AutomationRule): string {
  return [event.tenantId, rule.id, rule.version, event.eventId].map(encodeURIComponent).join(":");
}

export function validateAutomationRule(rule: AutomationRule): void {
  if (!rule.id || !rule.tenantId || !rule.trigger.event || !Number.isSafeInteger(rule.version) || rule.version < 1) throw new Error("Invalid automation rule identity");
  if (!rule.actions.length || rule.actions.length > 20) throw new Error("Automation must have 1–20 actions");
  for (const action of rule.actions) {
    if (!ACTION_TYPES.has(action.actionType)) throw new Error(`Unsupported action: ${action.actionType}`);
    if (action.delay && ("afterEventMinutes" in action.delay ? action.delay.afterEventMinutes : action.delay.offsetMinutes) > 525600) throw new Error("Automation delay exceeds one year");
    if (action.actionType === "enqueue_followup_automation" && action.configuration.ruleId === rule.id) throw new Error("Automation cannot enqueue itself");
    if (OBVIOUS_EVENTS[action.actionType] === rule.trigger.event && !rule.conditions && !rule.trigger.filters) throw new Error("Automation would directly trigger itself");
  }
}

export function evaluateAutomationRule(rule: AutomationRule, event: DomainEvent, options: { previous?: Record<string, unknown>; now?: string } = {}): AutomationEvaluation {
  if (rule.tenantId !== event.tenantId) return { matched: false, reason: "Tenant mismatch" };
  if (rule.status !== "active") return { matched: false, reason: "Rule is inactive" };
  if (rule.trigger.event !== event.eventType) return { matched: false, reason: "Different event" };
  if ((event.chainDepth ?? 0) >= MAX_EVENT_CHAIN_DEPTH) return { matched: false, reason: "Event chain depth exceeded" };
  const context = { current: { event, ...event.payload }, previous: options.previous, now: options.now ?? event.occurredAt };
  if (!evaluateConditions(rule.trigger.filters, context)) return { matched: false, reason: "Trigger filters did not match" };
  if (!evaluateConditions(rule.conditions, context)) return { matched: false, reason: "Conditions did not match" };
  return { matched: true };
}

function scheduledAt(action: AutomationAction, event: DomainEvent): string {
  const eventTime = new Date(event.occurredAt).getTime();
  if (!Number.isFinite(eventTime)) throw new Error("Event timestamp must be valid");
  if (!action.delay) return new Date(eventTime).toISOString();
  if ("afterEventMinutes" in action.delay) {
    if (!Number.isSafeInteger(action.delay.afterEventMinutes) || action.delay.afterEventMinutes < 0) throw new Error("Invalid delay");
    return new Date(eventTime + action.delay.afterEventMinutes * 60000).toISOString();
  }
  if (!Number.isSafeInteger(action.delay.offsetMinutes)) throw new Error("Invalid relative delay");
  const fieldValue = resolvePath({ event, ...event.payload }, action.delay.relativeToField);
  const relativeTime = typeof fieldValue === "string" ? new Date(fieldValue).getTime() : NaN;
  if (!Number.isFinite(relativeTime)) throw new Error(`Delay field ${action.delay.relativeToField} is missing or invalid`);
  return new Date(relativeTime + action.delay.offsetMinutes * 60000).toISOString();
}

export function planAutomationRun(rule: AutomationRule, event: DomainEvent, options: { previous?: Record<string, unknown>; now?: string } = {}): AutomationPlan | undefined {
  validateAutomationRule(rule);
  if (!evaluateAutomationRule(rule, event, options).matched) return undefined;
  const runKey = automationRunKey(event, rule);
  const actions = rule.actions.map((action, index) => {
    const dedupeValue = action.dedupeKeyTemplate ? renderTemplate(action.dedupeKeyTemplate, event) : undefined;
    if (action.dedupeKeyTemplate && !dedupeValue?.trim()) throw new Error("Automation dedupe key resolved to an empty value");
    const executionKey = dedupeValue ? `${encodeURIComponent(event.tenantId)}:${encodeURIComponent(rule.id)}:${rule.version}:action:${index}:dedupe:${encodeURIComponent(dedupeValue)}` : `${runKey}:action:${index}`;
    return { index, executionKey, scheduledAt: scheduledAt(action, event), action };
  });
  return Object.freeze({ runKey, ruleId: rule.id, ruleVersion: rule.version, tenantId: rule.tenantId, eventId: event.eventId, correlationId: event.correlationId, actions: Object.freeze(actions) });
}

/** Resolve safe placeholders for previews and execution without evaluating tenant code. */
export function renderActionConfiguration(configuration: Record<string, unknown>, event: DomainEvent): Record<string, unknown> {
  const render = (value: unknown, depth: number): unknown => {
    if (depth > 12) throw new Error("Automation configuration is too deep");
    if (typeof value === "string") return renderTemplate(value, event);
    if (Array.isArray(value)) return value.map((item) => render(item, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item, depth + 1)]));
    return value;
  };
  return render(configuration, 0) as Record<string, unknown>;
}

function renderTemplate(template: string, event: DomainEvent): string {
  const data = { event, ...event.payload };
  return template.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g, (_match, path: string) => String(resolvePath(data, path) ?? ""));
}

export function simulateAutomation(rule: AutomationRule, event: DomainEvent): { evaluation: AutomationEvaluation; actions: readonly { actionType: AutomationActionType; scheduledAt: string; configuration: Record<string, unknown> }[] } {
  const evaluation = evaluateAutomationRule(rule, event);
  if (!evaluation.matched) return { evaluation, actions: [] };
  const plan = planAutomationRun(rule, event)!;
  return { evaluation, actions: plan.actions.map(({ action, scheduledAt }) => ({ actionType: action.actionType, scheduledAt, configuration: renderActionConfiguration(action.configuration, event) })) };
}

export type AutomationExecutionState = { status: "running" | "succeeded" | "failed"; attempts: number; nextAttemptAt?: string; errorCode?: string };
export interface AutomationLedger {
  claim(executionKey: string, now: string): Promise<{ claimed: boolean; attempts: number }>;
  settle(executionKey: string, state: AutomationExecutionState): Promise<void>;
}
export class InMemoryAutomationLedger implements AutomationLedger {
  readonly states = new Map<string, AutomationExecutionState>();
  async claim(executionKey: string, now: string): Promise<{ claimed: boolean; attempts: number }> {
    const state = this.states.get(executionKey);
    if (state?.status === "succeeded" || state?.status === "running" || (state?.status === "failed" && state.nextAttemptAt && state.nextAttemptAt > now)) return { claimed: false, attempts: state?.attempts ?? 0 };
    const attempts = (state?.attempts ?? 0) + 1;
    this.states.set(executionKey, { status: "running", attempts });
    return { claimed: true, attempts };
  }
  async settle(executionKey: string, state: AutomationExecutionState): Promise<void> { this.states.set(executionKey, state); }
}

export type AutomationExecutionResult = Readonly<{ executionKey: string; status: "succeeded" | "skipped" | "retry_scheduled" | "failed"; attempts: number; errorCode?: string; nextAttemptAt?: string }>;

function classifyError(error: unknown): { code: string; retryable: boolean } {
  const item = error as { code?: unknown; retryable?: unknown };
  const code = typeof item?.code === "string" ? item.code : "unknown_error";
  return { code, retryable: item?.retryable === true || code === "timeout" || code === "provider_error" || code === "connector_unavailable" };
}

/** The caller supplies authorized domain-service actions and a durable ledger in production. */
export async function executeAutomationPlan(input: {
  plan: AutomationPlan;
  rule: AutomationRule;
  event: DomainEvent;
  now: string;
  ledger: AutomationLedger;
  execute: (action: AutomationAction, event: DomainEvent, executionKey: string) => Promise<void>;
  currentContext?: Record<string, unknown>;
  maxAttempts?: number;
}): Promise<readonly AutomationExecutionResult[]> {
  const { plan, rule, event, ledger, now } = input;
  if (!Number.isFinite(new Date(now).getTime())) throw new Error("Execution time must be valid");
  if (plan.tenantId !== event.tenantId || rule.tenantId !== event.tenantId || plan.eventId !== event.eventId || plan.ruleId !== rule.id || plan.ruleVersion !== rule.version) throw new Error("Automation plan scope mismatch");
  const results: AutomationExecutionResult[] = [];
  for (const item of plan.actions) {
    if (item.scheduledAt > now) { results.push({ executionKey: item.executionKey, status: "skipped", attempts: 0 }); continue; }
    if (rule.recheckConditions !== false && input.currentContext && !evaluateConditions(rule.conditions, { current: input.currentContext, now })) { results.push({ executionKey: item.executionKey, status: "skipped", attempts: 0 }); continue; }
    const claim = await ledger.claim(item.executionKey, now);
    if (!claim.claimed) { results.push({ executionKey: item.executionKey, status: "skipped", attempts: claim.attempts }); continue; }
    try {
      await input.execute({ ...item.action, configuration: renderActionConfiguration(item.action.configuration, event) }, event, item.executionKey);
      await ledger.settle(item.executionKey, { status: "succeeded", attempts: claim.attempts });
      results.push({ executionKey: item.executionKey, status: "succeeded", attempts: claim.attempts });
    } catch (error) {
      const normalized = classifyError(error);
      const retry = normalized.retryable && claim.attempts < (input.maxAttempts ?? 5);
      const nextAttemptAt = retry ? new Date(new Date(now).getTime() + Math.min(3600000, 60000 * 2 ** (claim.attempts - 1))).toISOString() : undefined;
      await ledger.settle(item.executionKey, { status: "failed", attempts: claim.attempts, errorCode: normalized.code, nextAttemptAt });
      results.push({ executionKey: item.executionKey, status: retry ? "retry_scheduled" : "failed", attempts: claim.attempts, errorCode: normalized.code, nextAttemptAt });
      if (!item.action.continueOnError) break;
    }
  }
  return results;
}
