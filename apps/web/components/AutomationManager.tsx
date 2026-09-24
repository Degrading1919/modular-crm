"use client";

import { useCallback, useEffect, useState } from "react";
import { api, body, date, friendly, patch, unwrapItems } from "./api";
import AutomationRuleBuilder, { type AutomationRuleBuilderRule } from "./AutomationRuleBuilder";

type AutomationRule = AutomationRuleBuilderRule & {
  source?: string;
  version?: number;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
};

export type AutomationRun = {
  id: string;
  ruleId: string;
  ruleVersion?: number;
  trigger: string;
  entityType?: string;
  entityId?: string;
  status: string;
  attempts: number;
  eventOccurredAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  nextRetryAt?: string | null;
  errorMessage?: string | null;
  /** Supplied by the server after checking the failure category and retry policy. */
  retryable?: boolean;
};

export type AutomationManagerProps = {
  rulesEndpoint?: string;
  runsEndpoint?: (ruleId?: string) => string;
  /** POST endpoint factory; defaults to `/automations/runs/:runId/retry` and expects an item/run response. */
  retryEndpoint?: (runId: string) => string;
  onChanged?: () => void;
};

export function isAutomationRunRetryable(run: Pick<AutomationRun, "status" | "retryable">): boolean {
  return run.status === "retry" && run.retryable === true;
}

const TRIGGER_LABELS: Record<string, string> = {
  "job.completed": "A service visit is completed",
  "invoice.issued": "An invoice is sent",
  "payment.failed": "A payment fails",
  "lead.created": "A new customer inquiry arrives",
  "customer_change_request.submitted": "A customer asks to change service",
};

export function automationTriggerLabel(trigger: string | undefined): string {
  if (!trigger) return "Business activity";
  return TRIGGER_LABELS[trigger] ?? friendly(trigger);
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "No runs yet";
  const labels: Record<string, string> = {
    active: "On", paused: "Paused", draft: "Draft", archived: "Archived",
    queued: "Waiting", running: "In progress", retry: "Retry scheduled", completed: "Completed", failed: "Failed", skipped: "Skipped",
  };
  return labels[status] ?? friendly(status);
}

function statusClass(status: string | null | undefined): string {
  if (status === "failed") return "badge badge-bad";
  if (status === "active" || status === "completed") return "badge badge-good";
  if (status === "retry" || status === "running") return "badge badge-warm";
  return "badge badge-neutral";
}

export default function AutomationManager({
  rulesEndpoint = "/automations",
  runsEndpoint = (ruleId) => ruleId ? `/automations/${encodeURIComponent(ruleId)}/runs?limit=100` : "/automations/runs?limit=100",
  retryEndpoint = (runId) => `/automations/runs/${encodeURIComponent(runId)}/retry`,
  onChanged,
}: AutomationManagerProps) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingRules, setLoadingRules] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [busyRuleId, setBusyRuleId] = useState("");
  const [busyRunId, setBusyRunId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadRules = useCallback(async () => {
    setLoadingRules(true);
    try {
      const result = await api<{ items?: AutomationRule[] }>(rulesEndpoint);
      setRules(unwrapItems(result));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Automation rules could not be loaded.");
    } finally {
      setLoadingRules(false);
    }
  }, [rulesEndpoint]);

  const loadRuns = useCallback(async (ruleId: string) => {
    setLoadingRuns(true);
    try {
      const result = await api<{ items?: AutomationRun[] }>(runsEndpoint(ruleId || undefined));
      setRuns(unwrapItems(result));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Automation history could not be loaded.");
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }, [runsEndpoint]);

  useEffect(() => { void loadRules(); }, [loadRules]);
  useEffect(() => { void loadRuns(selectedRuleId); }, [loadRuns, selectedRuleId]);

  async function refresh() {
    setError("");
    await Promise.all([loadRules(), loadRuns(selectedRuleId)]);
  }

  async function changeStatus(rule: AutomationRule) {
    const nextStatus = rule.status === "active" ? "paused" : "active";
    setBusyRuleId(rule.id);
    setError(""); setNotice("");
    try {
      await api(`${rulesEndpoint}/${encodeURIComponent(rule.id)}`, patch({ status: nextStatus }));
      setNotice(nextStatus === "active" ? "Automation turned on." : "Automation paused.");
      await loadRules();
      onChanged?.();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "This automation could not be updated.");
    } finally {
      setBusyRuleId("");
    }
  }

  async function retryRun(run: AutomationRun) {
    if (!isAutomationRunRetryable(run)) return;
    setBusyRunId(run.id);
    setError(""); setNotice("");
    try {
      await api(retryEndpoint(run.id), body({}));
      setNotice("The failed step was queued to try again.");
      await loadRuns(selectedRuleId);
      onChanged?.();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "This step could not be retried.");
    } finally {
      setBusyRunId("");
    }
  }

  function closeBuilder() { setCreating(false); setEditingRule(null); }
  async function saved() {
    closeBuilder();
    setNotice("Automation rule saved.");
    await refresh();
    onChanged?.();
  }

  return <div className="stack" aria-label="Automation manager">
    <section className="card card-pad stack" aria-labelledby="automation-rules-heading">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Your business</p>
          <h2 id="automation-rules-heading">Automation rules</h2>
          <p className="subtle">Review what happens automatically and when each rule last ran.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEditingRule(null); setCreating(true); }}>Create a rule</button>
      </div>
      {loadingRules ? <p role="status" className="subtle">Loading automations…</p> : rules.length === 0 ?
        <div className="empty"><h3>No automation rules yet</h3><p>Create a rule to send a follow-up or remind your team when something happens.</p></div> :
        <div className="stack">
          {rules.map((rule) => <article className="action-item" key={rule.id}>
            <div className="action-icon" aria-hidden="true">✦</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{rule.name}</strong>
              <p className="subtle" style={{ margin: "4px 0" }}>{rule.description || automationTriggerLabel(rule.triggerConfig?.event ?? rule.trigger)}</p>
              <p className="subtle" style={{ margin: 0, fontSize: ".8rem" }}>
                {automationTriggerLabel(rule.triggerConfig?.event ?? rule.trigger)} · Last run: {rule.lastRunAt ? date(rule.lastRunAt) : "Never"}
              </p>
            </div>
            <span className={statusClass(rule.status)}>{statusLabel(rule.status)}</span>
            <div className="inline-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setCreating(false); setEditingRule(rule); }}>Edit</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedRuleId(rule.id)} aria-label={`View history for ${rule.name}`}>History</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void changeStatus(rule)} disabled={busyRuleId === rule.id}>
                {busyRuleId === rule.id ? "Saving…" : rule.status === "active" ? "Pause" : "Turn on"}
              </button>
            </div>
          </article>)}
        </div>}
    </section>

    {(creating || editingRule) && <section className="card card-pad stack" aria-labelledby="automation-builder-heading">
      <div className="card-heading">
        <div><p className="eyebrow">Automation setup</p><h2 id="automation-builder-heading">{editingRule ? `Edit ${editingRule.name}` : "Create an automation rule"}</h2></div>
        <button type="button" className="btn btn-secondary" onClick={closeBuilder}>Close</button>
      </div>
      <AutomationRuleBuilder key={editingRule?.id ?? "new"} initialRule={editingRule ?? undefined} endpoint={rulesEndpoint} onCancel={closeBuilder} onSaved={() => void saved()} />
    </section>}

    <section className="card card-pad stack" aria-labelledby="automation-history-heading">
      <div className="card-heading">
        <div><p className="eyebrow">Recent activity</p><h2 id="automation-history-heading">Run history</h2><p className="subtle">See when a rule ran, whether it succeeded, and what needs attention.</p></div>
        <div className="field">
          <label htmlFor="automation-history-filter">Show history for</label>
          <select id="automation-history-filter" value={selectedRuleId} onChange={(event) => { setError(""); setSelectedRuleId(event.target.value); }}>
            <option value="">All rules</option>
            {rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {notice && <p className="notice notice-success" role="status">{notice}</p>}
      {loadingRuns ? <p role="status" className="subtle">Loading run history…</p> : runs.length === 0 ?
        <div className="empty"><h3>No runs to show</h3><p>When an automation matches a business event, its progress will appear here.</p></div> :
        <div className="stack">
          {runs.map((run) => {
            const ruleName = rules.find((rule) => rule.id === run.ruleId)?.name ?? "Automation rule";
            return <article className="action-item" key={run.id}>
              <div className="action-icon" aria-hidden="true">◷</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{ruleName}</strong>
                <p className="subtle" style={{ margin: "4px 0" }}>{automationTriggerLabel(run.trigger)} · {date(run.eventOccurredAt ?? run.startedAt ?? null)}</p>
                <p className="subtle" style={{ margin: 0, fontSize: ".8rem" }}>
                  {run.attempts} {run.attempts === 1 ? "attempt" : "attempts"}
                  {run.errorMessage ? ` · ${run.errorMessage}` : ""}
                </p>
              </div>
              <span className={statusClass(run.status)}>{statusLabel(run.status)}</span>
              {isAutomationRunRetryable(run) && <button type="button" className="btn btn-secondary btn-sm" disabled={busyRunId === run.id} onClick={() => void retryRun(run)}>
                {busyRunId === run.id ? "Queuing…" : "Retry now"}
              </button>}
            </article>;
          })}
        </div>}
    </section>
  </div>;
}
