"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, body, patch as patchRequest, unwrapItem } from "./api";
import { Icon, Loading, Logo, Notice } from "./ui";

export type CapabilityModule = {
  key: string;
  name: string;
  description?: string | null;
  required?: boolean;
  recommended?: boolean;
  entitled?: boolean;
  enabled?: boolean;
  usable?: boolean;
  available?: boolean;
  uiProminence?: string;
  featureKeys?: string[];
  recommendations?: { featureKey: string; recommendation: string; rationale?: string }[];
};

export type CapabilityFeature = { name?: string; visible?: boolean; usable?: boolean };
export type CapabilityQuestion = { key: string; prompt: string; answerType?: "boolean" | "number" | "enum"; options?: string[] };
export type CapabilityCatalog = {
  modules: CapabilityModule[];
  features: Record<string, CapabilityFeature>;
  questions?: CapabilityQuestion[];
  answers?: Record<string, string | number | boolean>;
  recommendedModuleKeys?: string[];
  packName?: string | null;
  setupComplete?: boolean;
  commercialTermsConfigured?: boolean;
  selectedModuleKeys?: string[];
};

type CapabilityResponse = { item?: CapabilityCatalog } | CapabilityCatalog;
type AnswerValue = string | number | boolean;

export function featureIsUsable(features: Record<string, CapabilityFeature> | undefined, featureKeys: readonly string[]): boolean {
  return featureKeys.length === 0 || featureKeys.some((key) => features?.[key]?.usable === true);
}

export function featureIsVisible(features: Record<string, CapabilityFeature> | undefined, featureKeys: readonly string[]): boolean {
  return featureKeys.length === 0 || featureKeys.some((key) => features?.[key]?.visible === true);
}

export function isWebsitePublishingUsable(catalog: CapabilityCatalog | null | undefined): boolean {
  return catalog?.features?.website_publishing?.usable === true;
}

export function initiallySelectedModuleKeys(modules: readonly CapabilityModule[], mode: "setup" | "manage", recommendedKeys: readonly string[] = []): string[] {
  if (mode === "setup") return [...recommendedKeys];
  return modules.filter((module) => module.required || (module.entitled && module.enabled)).map((module) => module.key);
}

export default function CapabilitySetup({
  mode,
  setupProgress,
  onComplete,
  onBackToIndustry,
  onSaved,
  canManage = true,
}: {
  mode: "setup" | "manage";
  setupProgress?: { step: number; total: number };
  onComplete?: (catalog: CapabilityCatalog | null) => void;
  onBackToIndustry?: () => void;
  onSaved?: () => void;
  canManage?: boolean;
}) {
  const result = useResourceCapabilities();
  const catalog = result.catalog;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const initialized = useRef(false);
  const completed = useRef(false);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [moduleKeys, setModuleKeys] = useState<string[]>([]);
  const [customizing, setCustomizing] = useState(mode === "manage");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [suggestionsStale, setSuggestionsStale] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (result.loading || result.error || !catalog) return;
    if (!initialized.current) {
      initialized.current = true;
      const initialAnswers = catalog.answers ?? {};
      setAnswers(initialAnswers);
      setModuleKeys(initiallySelectedModuleKeys(catalog.modules ?? [], mode, catalog.recommendedModuleKeys ?? []));
    }
    if (mode === "setup" && catalog.setupComplete && !completed.current) {
      completed.current = true;
      onComplete?.(catalog);
    }
  }, [catalog, result.error, result.loading, mode, onComplete]);

  useEffect(() => {
    if (mode === "setup" && !result.loading && catalog) titleRef.current?.focus();
  }, [catalog, mode, result.loading]);

  async function updateRecommendations(): Promise<boolean> {
    setRefreshing(true); setError("");
    try {
      const response = await api<CapabilityResponse>("/capabilities/recommendations", body({ answers }));
      const updated = unwrapItem(response) as CapabilityCatalog;
      result.replace({ item: updated });
      if (mode === "setup") setModuleKeys(updated.recommendedModuleKeys ?? []);
      setSuggestionsStale(false);
      setNotice("Suggestions updated for the answers you gave.");
      return true;
    } catch (issue) { setError((issue as Error).message); return false; }
    finally { setRefreshing(false); }
  }

  async function returnToSuggestions() {
    if (suggestionsStale) {
      if (!await updateRecommendations()) return;
    } else setModuleKeys(catalog?.recommendedModuleKeys ?? []);
    setCustomizing(false);
  }

  async function saveSetup(selection: "recommended" | "custom") {
    setBusy(true); setError(""); setNotice("");
    const payload = selection === "recommended"
      ? { selection, answers }
      : { selection, answers, moduleKeys };
    try {
      const response = await api<CapabilityResponse>("/capabilities/setup", body(payload));
      const updated = unwrapItem(response) as CapabilityCatalog;
      result.replace({ item: updated });
      setModuleKeys(updated.selectedModuleKeys ?? moduleKeys);
      if (mode === "setup") {
        completed.current = true;
        onComplete?.(updated);
      } else {
        setNotice("Your capability choices are saved.");
        onSaved?.();
      }
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }

  async function changeNavigation(module: CapabilityModule, visible: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/capabilities/${encodeURIComponent(module.key)}`, patchRequest({ uiProminence: visible ? "standard" : "hidden" }));
      result.reload();
      setNotice(visible ? `${module.name} will appear in navigation when ready.` : `${module.name} is hidden from navigation.`);
      onSaved?.();
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }

  if (result.loading) return <Loading label="Loading your business tools…"/>;

  if (result.error || !catalog) {
    return <CapabilityShell mode={mode} setupProgress={setupProgress}>
      <Notice kind="error" text={result.error || "Your business tools could not be loaded. Please try again."}/>
      <div className="inline-actions" style={{ marginTop: 18 }}>
        {mode === "setup" && onBackToIndustry && <button type="button" className="btn btn-secondary" onClick={onBackToIndustry}>Back to industry</button>}
        <button type="button" className="btn btn-secondary" onClick={result.reload}>Try again</button>
        {mode === "setup" && <button type="button" className="btn btn-primary" onClick={() => onComplete?.(null)}>Continue to business setup</button>}
      </div>
    </CapabilityShell>;
  }

  const requiredKeys = new Set(catalog.modules.filter((module) => module.required).map((module) => module.key));
  const recommendedKeys = catalog.recommendedModuleKeys ?? [];
  const sortedModules = [...catalog.modules].sort((left, right) => Number(Boolean(right.required)) - Number(Boolean(left.required)) || left.name.localeCompare(right.name));
  const questionFields = catalog.questions ?? [];
  function updateAnswer(question: CapabilityQuestion, value: string) {
    const next = { ...answers };
    if (value === "") delete next[question.key];
    else if (question.answerType === "boolean") next[question.key] = value === "yes";
    else if (question.answerType === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      next[question.key] = parsed;
    } else next[question.key] = value;
    setAnswers(next); setSuggestionsStale(true);
  }

  return <CapabilityShell mode={mode} setupProgress={setupProgress}>
    <section className="card card-pad" aria-labelledby="capability-setup-title">
      {mode === "setup" ? <>
        <div className="eyebrow">Suggested tools</div>
        <h1 id="capability-setup-title" ref={titleRef} tabIndex={-1}>Choose the tools you need now</h1>
        <p className="subtle">These suggestions fit {catalog.packName || "your business"}. Choose what you need today. You can add tools later.</p>
        {!customizing && <>
          <div className="module-list" style={{ marginTop: 18 }}>
            {sortedModules.filter((module) => module.required || recommendedKeys.includes(module.key)).map((module) => <CapabilitySummary key={module.key} module={module} recommended={recommendedKeys.includes(module.key)}/>) }
          </div>
          <div className="onboarding-footer" style={{ marginTop: 22 }}>
            {onBackToIndustry ? <button type="button" className="btn btn-secondary" onClick={onBackToIndustry}>Back to industry</button> : <span/>}
            <div className="inline-actions"><button type="button" className="btn btn-secondary" onClick={() => setCustomizing(true)}>Choose different tools</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveSetup("recommended")}>{busy ? "Saving…" : "Continue with these tools"}<Icon name="arrow" size={16}/></button></div>
          </div>
        </>}
        {customizing && <>
          {questionFields.length > 0 && <section className="recommendation-answers" aria-labelledby="recommendation-answers-title" style={{ marginTop: 20 }}>
            <h2 id="recommendation-answers-title">A few questions about your work</h2>
            <p className="subtle">Your answers help us tailor these suggestions. Skip anything you’re unsure about.</p>
            <div className="stack" style={{ marginTop: 14 }}>
              {questionFields.map((question) => <div className="field" key={question.key}>
                <label htmlFor={`capability-answer-${question.key}`}>{question.prompt}</label>
                <RecommendationAnswer question={question} value={answers[question.key]} id={`capability-answer-${question.key}`} onChange={(value) => updateAnswer(question, value)}/>
              </div>)}
            </div>
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 14 }} disabled={refreshing || !suggestionsStale} onClick={updateRecommendations}>{refreshing ? "Updating suggestions…" : "Refresh suggestions"}</button>
          </section>}
          <div className="section-title" style={{ marginTop: 24 }}><h2>Choose tools</h2><span className="muted-label">Core tools stay on</span></div>
          <div className="module-list">
            {sortedModules.map((module) => <label className={`module-option ${module.required || module.available === false ? "disabled" : ""}`} key={module.key}>
              <input type="checkbox" checked={requiredKeys.has(module.key) || moduleKeys.includes(module.key)} disabled={module.required || module.available === false || busy} onChange={(event) => setModuleKeys((previous) => event.target.checked ? [...new Set([...previous, module.key])] : previous.filter((key) => key !== module.key))}/>
              <span className="module-option-copy"><span className="inline-actions"><strong>{module.name}</strong>{module.required && <span className="badge badge-neutral">Core</span>}{recommendedKeys.includes(module.key) && !module.required && <span className="badge badge-good">Suggested</span>}</span><span className="subtle">{module.description || "Tools to support this part of your business."}</span></span>
            </label>)}
          </div>
          <div className="onboarding-footer" style={{ marginTop: 26 }}>
            <div className="inline-actions">{onBackToIndustry && <button type="button" className="btn btn-secondary" disabled={busy || refreshing} onClick={onBackToIndustry}>Back to industry</button>}<button type="button" className="btn btn-secondary" disabled={busy || refreshing} onClick={returnToSuggestions}>Back to suggestions</button></div>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveSetup("custom")}>{busy ? "Saving…" : "Continue with these tools"}<Icon name="arrow" size={16}/></button>
          </div>
        </>}
      </> : <>
        <div className="page-head" style={{ marginBottom: 22 }}><div><div className="eyebrow">Workspace settings</div><h1 id="capability-setup-title">Tools for your business</h1><p>Choose which tools are active and which appear in your navigation.</p></div></div>
        {!canManage && <div className="notice notice-info" style={{ marginBottom: 18 }}>Only a workspace owner can change these choices.</div>}
        <div className="module-list">
          {sortedModules.map((module) => {
            const selected = requiredKeys.has(module.key) || moduleKeys.includes(module.key);
            return <div className="module-option module-setting" key={module.key}>
              <label className="module-toggle"><input type="checkbox" aria-label={`Use ${module.name}`} checked={selected} disabled={!canManage || module.required || module.available === false || busy} onChange={(event) => setModuleKeys((previous) => event.target.checked ? [...new Set([...previous, module.key])] : previous.filter((key) => key !== module.key))}/></label>
              <div className="module-option-copy"><div className="inline-actions"><strong>{module.name}</strong>{module.required && <span className="badge badge-neutral">Core</span>}{module.recommended && <span className="badge badge-good">Suggested</span>}</div><p className="subtle">{module.description || "Tools to support this part of your business."}</p><div className="module-status"><span>Access: {module.required || module.entitled ? "Included" : "Not included"}</span><span>Tool: {module.enabled ? "On" : "Off"}</span><span>{module.usable ? "Ready to use" : selected ? "Selected, setup needed" : "Not selected"}</span></div></div>
              <div className="module-option-actions">
                {canManage && selected && module.usable && !module.required && <label className="checkbox-row"><input type="checkbox" checked={module.uiProminence !== "hidden"} disabled={busy} onChange={(event) => changeNavigation(module, event.target.checked)}/>Show in navigation</label>}
              </div>
            </div>;
          })}
        </div>
        {canManage && questionFields.length > 0 && <details style={{ marginTop: 20 }}><summary className="link" style={{ cursor: "pointer" }}>Update the details used for suggestions</summary><div className="stack" style={{ marginTop: 15 }}>{questionFields.map((question) => <div className="field" key={question.key}><label htmlFor={`manage-answer-${question.key}`}>{question.prompt}</label><RecommendationAnswer question={question} value={answers[question.key]} id={`manage-answer-${question.key}`} onChange={(value) => updateAnswer(question, value)}/></div>)}</div><button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 16 }} disabled={refreshing || !suggestionsStale} onClick={updateRecommendations}>{refreshing ? "Updating suggestions…" : "Update suggestions"}</button></details>}
        {canManage && <div className="inline-actions" style={{ marginTop: 24 }}><button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveSetup("custom")}>{busy ? "Saving…" : "Save tool choices"}</button></div>}
      </>}
      {error && <div style={{ marginTop: 18 }}><Notice kind="error" text={error}/></div>}
      {notice && <div style={{ marginTop: 18 }}><Notice kind="success" text={notice}/></div>}
    </section>
  </CapabilityShell>;
}

function CapabilitySummary({ module, recommended }: { module: CapabilityModule; recommended: boolean }) {
  return <div className="module-summary"><div className="inline-actions"><strong>{module.name}</strong>{module.required ? <span className="badge badge-neutral">Core</span> : recommended ? <span className="badge badge-good">Suggested</span> : null}</div><p className="subtle">{module.description || "Tools to support this part of your business."}</p></div>;
}

function RecommendationAnswer({ question, value, id, onChange }: { question: CapabilityQuestion; value: AnswerValue | undefined; id: string; onChange: (value: string) => void }) {
  if (question.answerType === "number") return <input id={id} type="number" step="any" value={typeof value === "number" ? String(value) : ""} onChange={(event) => onChange(event.target.value)} />;
  if (question.answerType === "enum") return <select id={id} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>
    <option value="">Skip this question</option>{(question.options ?? []).map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}
  </select>;
  return <select id={id} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(event) => onChange(event.target.value)}>
    <option value="">Skip this question</option><option value="yes">Yes</option><option value="no">No</option>
  </select>;
}

function CapabilityShell({ children, mode, setupProgress }: { children: React.ReactNode; mode: "setup" | "manage"; setupProgress?: { step: number; total: number } }) {
  if (mode === "manage") return <>{children}</>;
  return <div className="onboarding"><header className="onboarding-header"><Link href="/app/dashboard"><Logo/></Link><span className="muted-label">Step {setupProgress?.step ?? 1} of {setupProgress?.total ?? 1} · Tools</span></header><main className="onboarding-main">{setupProgress && <div className="onboarding-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={setupProgress.total} aria-valuenow={setupProgress.step} aria-valuetext={`Step ${setupProgress.step} of ${setupProgress.total}: Your tools`}>{Array.from({ length: setupProgress.total }, (_, index) => <span key={index} className={index < setupProgress.step ? "done" : ""} aria-hidden="true"/>)}</div>}{children}</main></div>;
}

function useResourceCapabilities() {
  const [data, setData] = useState<CapabilityResponse>({ item: { modules: [], features: {} } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<CapabilityResponse>("/capabilities").then((response) => { if (active) { setData(response); setError(""); } })
      .catch((issue) => { if (active) setError((issue as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);
  return {
    catalog: unwrapItem(data) as CapabilityCatalog,
    loading,
    error,
    reload: () => setVersion((current) => current + 1),
    replace: (next: CapabilityResponse) => { setData(next); setError(""); },
  };
}
