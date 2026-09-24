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
export type CapabilityQuestion = { key: string; prompt: string; answerType?: string };
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
  onComplete,
  onSaved,
  canManage = true,
}: {
  mode: "setup" | "manage";
  onComplete?: (catalog: CapabilityCatalog | null) => void;
  onSaved?: () => void;
  canManage?: boolean;
}) {
  const result = useResourceCapabilities();
  const catalog = result.catalog;
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
    return <CapabilityShell mode={mode}>
      <Notice kind="error" text={result.error || "Your business tools could not be loaded. Please try again."}/>
      <div className="inline-actions" style={{ marginTop: 18 }}>
        <button type="button" className="btn btn-secondary" onClick={result.reload}>Try again</button>
        {mode === "setup" && <button type="button" className="btn btn-primary" onClick={() => onComplete?.(null)}>Continue to business setup</button>}
      </div>
    </CapabilityShell>;
  }

  const requiredKeys = new Set(catalog.modules.filter((module) => module.required).map((module) => module.key));
  const recommendedKeys = catalog.recommendedModuleKeys ?? [];
  const sortedModules = [...catalog.modules].sort((left, right) => Number(Boolean(right.required)) - Number(Boolean(left.required)) || left.name.localeCompare(right.name));
  const questionFields = (catalog.questions ?? []).filter((question) => question.answerType === "boolean");

  return <CapabilityShell mode={mode}>
    <section className="card card-pad" aria-labelledby="capability-setup-title">
      {mode === "setup" ? <>
        <div className="eyebrow">Your business tools</div>
        <h1 id="capability-setup-title">Choose what helps you run your business.</h1>
        <p className="subtle">We’ve picked a starting set based on {catalog.packName || "your business"}. You can change these choices later.</p>
        {!customizing && <>
          <div className="stack" style={{ marginTop: 22 }}>
            {sortedModules.filter((module) => module.required || recommendedKeys.includes(module.key)).map((module) => <CapabilitySummary key={module.key} module={module} recommended={recommendedKeys.includes(module.key)}/>) }
          </div>
          <div className="onboarding-footer" style={{ marginTop: 26 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCustomizing(true)}>Customize</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveSetup("recommended")}>{busy ? "Saving…" : "Accept recommended tools"}<Icon name="arrow" size={16}/></button>
          </div>
        </>}
        {customizing && <>
          {questionFields.length > 0 && <div className="card card-pad" style={{ boxShadow: "none", background: "#f7f8f4", marginTop: 20 }}>
            <h2>Tell us a little about your work</h2>
            <p className="subtle" style={{ fontSize: ".85rem" }}>Your answers help us suggest tools that fit. You can skip any question.</p>
            <div className="stack" style={{ marginTop: 16 }}>
              {questionFields.map((question) => <div className="field" key={question.key}>
                <label htmlFor={`capability-answer-${question.key}`}>{question.prompt}</label>
                <select id={`capability-answer-${question.key}`} value={answers[question.key] === true ? "yes" : answers[question.key] === false ? "no" : ""} onChange={(event) => {
                  const next = { ...answers };
                  if (event.target.value === "") delete next[question.key];
                  else next[question.key] = event.target.value === "yes";
                  setAnswers(next); setSuggestionsStale(true);
                }}>
                  <option value="">Skip this question</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              </div>)}
            </div>
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 16 }} disabled={refreshing || !suggestionsStale} onClick={updateRecommendations}>{refreshing ? "Updating suggestions…" : "Update suggestions"}</button>
          </div>}
          <div className="card-heading" style={{ marginTop: 24 }}><h2>Choose the tools you want</h2><span className="muted-label">Required tools stay on</span></div>
          <div className="stack" style={{ marginTop: 12 }}>
            {sortedModules.map((module) => <label className="card card-pad" key={module.key} style={{ boxShadow: "none", cursor: module.required || module.available === false ? "default" : "pointer" }}>
              <span className="checkbox-row"><input type="checkbox" checked={requiredKeys.has(module.key) || moduleKeys.includes(module.key)} disabled={module.required || module.available === false || busy} onChange={(event) => setModuleKeys((previous) => event.target.checked ? [...new Set([...previous, module.key])] : previous.filter((key) => key !== module.key))}/><strong>{module.name}</strong>{module.required && <span className="badge badge-neutral">Needed</span>}{recommendedKeys.includes(module.key) && !module.required && <span className="badge badge-good">Suggested</span>}</span>
              <span className="subtle" style={{ display: "block", fontSize: ".84rem", margin: "7px 0 0 29px" }}>{module.description || "Tools to support this part of your business."}</span>
            </label>)}
          </div>
          <div className="onboarding-footer" style={{ marginTop: 26 }}>
            <button type="button" className="btn btn-secondary" disabled={busy || refreshing} onClick={returnToSuggestions}>Back to suggestions</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveSetup("custom")}>{busy ? "Saving…" : "Save my choices"}<Icon name="arrow" size={16}/></button>
          </div>
        </>}
      </> : <>
        <div className="page-head" style={{ marginBottom: 22 }}><div><div className="eyebrow">Your workspace</div><h1 id="capability-setup-title">My capabilities</h1><p>Choose the tools your business needs. You can update this list as your work changes.</p></div></div>
        {!canManage && <div className="notice notice-info" style={{ marginBottom: 18 }}>Only a workspace owner can change these choices.</div>}
        <div className="stack">
          {sortedModules.map((module) => {
            const selected = requiredKeys.has(module.key) || moduleKeys.includes(module.key);
            return <div className="card card-pad" key={module.key}>
              <label className="checkbox-row"><input type="checkbox" checked={selected} disabled={!canManage || module.required || module.available === false || busy} onChange={(event) => setModuleKeys((previous) => event.target.checked ? [...new Set([...previous, module.key])] : previous.filter((key) => key !== module.key))}/><strong>{module.name}</strong>{module.required && <span className="badge badge-neutral">Needed</span>}{module.recommended && <span className="badge badge-good">Suggested</span>}</label>
              <p className="subtle" style={{ margin: "8px 0 0 28px", fontSize: ".84rem" }}>{module.description || "Tools to support this part of your business."}</p>
              <div className="inline-actions" style={{ justifyContent: "space-between", margin: "14px 0 0 28px" }}>
                <span className="muted-label">{module.usable ? "Ready to use" : selected ? "Selected, but not ready yet" : "Not selected"}</span>
                {canManage && selected && module.usable && !module.required && <label className="checkbox-row"><input type="checkbox" checked={module.uiProminence !== "hidden"} disabled={busy} onChange={(event) => changeNavigation(module, event.target.checked)}/>Show in navigation</label>}
              </div>
            </div>;
          })}
        </div>
        {canManage && questionFields.length > 0 && <details style={{ marginTop: 20 }}><summary className="link" style={{ cursor: "pointer" }}>Update the details used for suggestions</summary><div className="stack" style={{ marginTop: 15 }}>{questionFields.map((question) => <div className="field" key={question.key}><label htmlFor={`manage-answer-${question.key}`}>{question.prompt}</label><select id={`manage-answer-${question.key}`} value={answers[question.key] === true ? "yes" : answers[question.key] === false ? "no" : ""} onChange={(event) => { const next = { ...answers }; if (!event.target.value) delete next[question.key]; else next[question.key] = event.target.value === "yes"; setAnswers(next); setSuggestionsStale(true); }}><option value="">Skip this question</option><option value="yes">Yes</option><option value="no">No</option></select></div>)}</div><button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 16 }} disabled={refreshing || !suggestionsStale} onClick={updateRecommendations}>{refreshing ? "Updating suggestions…" : "Update suggestions"}</button></details>}
        {canManage && <div className="inline-actions" style={{ marginTop: 24 }}><button type="button" className="btn btn-primary" disabled={busy} onClick={() => saveSetup("custom")}>{busy ? "Saving…" : "Save my capabilities"}</button></div>}
      </>}
      {error && <div style={{ marginTop: 18 }}><Notice kind="error" text={error}/></div>}
      {notice && <div style={{ marginTop: 18 }}><Notice kind="success" text={notice}/></div>}
    </section>
  </CapabilityShell>;
}

function CapabilitySummary({ module, recommended }: { module: CapabilityModule; recommended: boolean }) {
  return <div className="card card-pad" style={{ boxShadow: "none" }}><div className="inline-actions" style={{ justifyContent: "space-between" }}><strong>{module.name}</strong>{module.required ? <span className="badge badge-neutral">Needed</span> : recommended ? <span className="badge badge-good">Suggested</span> : null}</div><p className="subtle" style={{ margin: "8px 0 0", fontSize: ".84rem" }}>{module.description || "Tools to support this part of your business."}</p></div>;
}

function CapabilityShell({ children, mode }: { children: React.ReactNode; mode: "setup" | "manage" }) {
  if (mode === "manage") return <>{children}</>;
  return <div className="onboarding"><header className="onboarding-header"><Link href="/app/dashboard"><Logo/></Link><span className="badge badge-neutral">Choose your tools</span></header><main className="onboarding-main">{children}</main></div>;
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
