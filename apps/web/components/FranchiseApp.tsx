"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, body, money, unwrapItem, unwrapItems } from "./api";
import { Badge, Empty, Loading, Notice } from "./ui";

type AgreementRow = {
  agreement: {
    id: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    active: boolean;
    settings: Record<string, unknown>;
  };
  child: { id: string; displayName: string; currency: string; active: boolean };
};
type RoyaltyRule = {
  id: string;
  ruleType: string;
  definition: { basis?: string; rateBasisPoints?: number };
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
};
type RoyaltyStatement = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  basisAmountMinor: number | string;
  royaltyAmountMinor: number | string;
  currency: string;
  calculationSnapshot?: { invoices?: Array<{ id: string; totalMinor: string }> };
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const initialPeriod = () => {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  return { start: isoDay(start), end: isoDay(today) };
};

export default function FranchiseApp() {
  const periodDefaults = useMemo(() => initialPeriod(), []);
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [rules, setRules] = useState<RoyaltyRule[]>([]);
  const [statements, setStatements] = useState<RoyaltyStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [unit, setUnit] = useState({ displayName: "", legalName: "", email: "", phone: "", timezone: "America/New_York", currency: "USD", effectiveFrom: isoDay(new Date()), locationName: "Main Branch", addressLine1: "", city: "", region: "", postalCode: "" });
  const [ratePercent, setRatePercent] = useState("5");
  const [period, setPeriod] = useState(periodDefaults);

  const selected = agreements.find((row) => row.agreement.id === selectedId);

  async function loadAgreements() {
    const result = await api<{ items?: AgreementRow[] }>("/franchise/agreements");
    const next = unwrapItems(result);
    setAgreements(next);
    setSelectedId((current) => next.some((row) => row.agreement.id === current) ? current : next[0]?.agreement.id ?? "");
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<{ items?: AgreementRow[] }>("/franchise/agreements").then((result) => {
      if (!active) return;
      const next = unwrapItems(result);
      setAgreements(next);
      setSelectedId((current) => next.some((row) => row.agreement.id === current) ? current : next[0]?.agreement.id ?? "");
    }).catch((issue) => { if (active) setError((issue as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setRules([]); setStatements([]); return; }
    let active = true;
    setDetailLoading(true);
    setError("");
    Promise.all([
      api<{ items?: RoyaltyRule[] }>(`/franchise/agreements/${selectedId}/rules`),
      api<{ items?: RoyaltyStatement[] }>(`/franchise/agreements/${selectedId}/statements`),
    ]).then(([ruleResult, statementResult]) => {
      if (!active) return;
      setRules(unwrapItems(ruleResult));
      setStatements(unwrapItems(statementResult));
    }).catch((issue) => { if (active) setError((issue as Error).message); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  async function createUnit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("unit"); setError(""); setNotice("");
    try {
      const result = await api<{ item?: unknown }>("/franchise/units", body({
        displayName: unit.displayName, ...(unit.legalName ? { legalName: unit.legalName } : {}),
        email: unit.email, phone: unit.phone, timezone: unit.timezone, currency: unit.currency,
        effectiveFrom: unit.effectiveFrom,
        location: { name: unit.locationName, addressLine1: unit.addressLine1, city: unit.city, region: unit.region, postalCode: unit.postalCode, timezone: unit.timezone },
      }));
      const created = unwrapItem(result) as { agreement?: { id?: string } };
      await loadAgreements();
      if (created.agreement?.id) setSelectedId(created.agreement.id);
      setUnit((current) => ({ ...current, displayName: "", legalName: "", email: "", phone: "", addressLine1: "", city: "", region: "", postalCode: "" }));
      setNotice("Franchise unit and its agreement were created.");
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(""); }
  }

  async function createRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const percentage = Number(ratePercent);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) { setError("Enter a royalty percentage greater than 0 and no more than 100."); return; }
    setBusy("rule"); setError(""); setNotice("");
    try {
      await api(`/franchise/agreements/${selectedId}/rules`, body({ ruleType: "percentage", definition: { basis: "invoiced_revenue", rateBasisPoints: Math.round(percentage * 100) }, effectiveFrom: selected.agreement.effectiveFrom }));
      const result = await api<{ items?: RoyaltyRule[] }>(`/franchise/agreements/${selectedId}/rules`);
      setRules(unwrapItems(result)); setNotice("Royalty rule saved.");
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(""); }
  }

  async function calculateStatement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    setBusy("statement"); setError(""); setNotice("");
    try {
      await api(`/franchise/agreements/${selectedId}/statements/calculate`, body({ periodStart: period.start, periodEnd: period.end }));
      const result = await api<{ items?: RoyaltyStatement[] }>(`/franchise/agreements/${selectedId}/statements`);
      setStatements(unwrapItems(result)); setNotice("Statement calculated from issued invoices in this period.");
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(""); }
  }

  return <>
    <div className="eyebrow">Business</div>
    <h1>Franchise</h1>
    <p className="subtle">Manage franchise units and calculate royalty statements from each unit’s issued invoices.</p>
    {error && <Notice kind="error" text={error}/>}
    {notice && <Notice kind="success" text={notice}/>}
    <div className="card card-pad" style={{ marginTop: 18 }}>
      <div className="card-heading"><div><div className="eyebrow">Organization</div><h2 style={{ margin: "4px 0" }}>Franchise units</h2></div><span className="table-secondary">{agreements.length} active agreements</span></div>
      {loading ? <Loading/> : agreements.length ? <div className="stack" style={{ marginBottom: 20 }}>{agreements.map((row) => <button key={row.agreement.id} type="button" className={`action-item ${selectedId === row.agreement.id ? "selected" : ""}`} style={{ textAlign: "left", width: "100%", cursor: "pointer" }} onClick={() => setSelectedId(row.agreement.id)}><div style={{ flex: 1 }}><strong>{row.child.displayName}</strong><p>{row.agreement.effectiveFrom}{row.agreement.effectiveTo ? ` – ${row.agreement.effectiveTo}` : " · ongoing"}</p></div><Badge status={row.agreement.active && row.child.active ? "active" : "inactive"}/></button>)}</div> : <Empty title="No franchise units yet" description="Add a unit below to start organizing child locations and royalty agreements."/>}
      <h3 style={{ margin: "20px 0 12px" }}>Add a unit</h3>
      <form className="form-grid" onSubmit={createUnit}>
        <Field label="Unit name" required value={unit.displayName} onChange={(displayName) => setUnit({ ...unit, displayName })}/>
        <Field label="Legal name" value={unit.legalName} onChange={(legalName) => setUnit({ ...unit, legalName })}/>
        <Field label="Email" type="email" value={unit.email} onChange={(email) => setUnit({ ...unit, email })}/>
        <Field label="Phone" type="tel" value={unit.phone} onChange={(phone) => setUnit({ ...unit, phone })}/>
        <Field label="First location" required value={unit.locationName} onChange={(locationName) => setUnit({ ...unit, locationName })}/>
        <Field label="Street address" value={unit.addressLine1} onChange={(addressLine1) => setUnit({ ...unit, addressLine1 })}/>
        <Field label="City" value={unit.city} onChange={(city) => setUnit({ ...unit, city })}/>
        <Field label="State / region" value={unit.region} onChange={(region) => setUnit({ ...unit, region })}/>
        <Field label="Postal code" value={unit.postalCode} onChange={(postalCode) => setUnit({ ...unit, postalCode })}/>
        <Field label="Agreement starts" type="date" required value={unit.effectiveFrom} onChange={(effectiveFrom) => setUnit({ ...unit, effectiveFrom })}/>
        <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy === "unit"}>{busy === "unit" ? "Creating…" : "Create unit"}</button></div>
      </form>
    </div>

    {selected && <div className="two-col" style={{ marginTop: 18 }}>
      <section className="card card-pad">
        <div className="eyebrow">{selected.child.displayName}</div><h2 style={{ margin: "4px 0 8px" }}>Royalty rule</h2>
        <p className="subtle">Apply a percentage to invoiced revenue for periods within the agreement dates.</p>
        {rules.length > 0 && <div className="stack" style={{ marginBottom: 16 }}>{rules.map((rule) => <div className="action-item" key={rule.id}><div style={{ flex: 1 }}><strong>{(Number(rule.definition.rateBasisPoints) / 100).toFixed(2)}% of invoiced revenue</strong><p>From {rule.effectiveFrom}{rule.effectiveTo ? ` through ${rule.effectiveTo}` : " · ongoing"}</p></div><Badge status={rule.active ? "active" : "inactive"}/></div>)}</div>}
        {rules.some((rule) => rule.active) ? <p className="subtle" style={{ fontSize: ".85rem" }}>This agreement already has an active rule. Add a new unit to configure its first rule; overlapping active rules are rejected.</p> : <form className="form-grid" onSubmit={createRule}>
          <Field label="Royalty percentage" type="number" min="0.01" max="100" step="0.01" required value={ratePercent} onChange={setRatePercent}/>
          <div className="form-actions"><button className="btn btn-secondary" type="submit" disabled={busy === "rule"}>{busy === "rule" ? "Saving…" : "Save royalty rule"}</button></div>
        </form>}
      </section>
      <section className="card card-pad">
        <div className="eyebrow">Statements</div><h2 style={{ margin: "4px 0 8px" }}>Calculate a period</h2>
        <p className="subtle">Only issued invoices from this franchise unit count toward the statement.</p>
        <form className="form-grid" onSubmit={calculateStatement}>
          <Field label="Period start" type="date" required value={period.start} onChange={(start) => setPeriod({ ...period, start })}/>
          <Field label="Period end" type="date" required value={period.end} onChange={(end) => setPeriod({ ...period, end })}/>
          <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={busy === "statement"}>{busy === "statement" ? "Calculating…" : "Calculate statement"}</button></div>
        </form>
        <div className="divider"/><h3>Statement history</h3>
        {detailLoading ? <Loading/> : statements.length ? <div className="stack">{statements.map((statement) => <article className="action-item" key={statement.id}><div style={{ flex: 1 }}><strong>{statement.periodStart} – {statement.periodEnd}</strong><p>{Number(statement.calculationSnapshot?.invoices?.length ?? 0)} issued invoices · basis {money(Number(statement.basisAmountMinor), statement.currency)}</p></div><div style={{ textAlign: "right" }}><Badge status={statement.status}/><div className="amount" style={{ marginTop: 5 }}>{money(Number(statement.royaltyAmountMinor), statement.currency)}</div><Link className="table-action" href={`/app/documents/royalty-statement/${statement.id}`}>View statement</Link></div></article>)}</div> : <Empty title="No statements yet" description="Calculate a period after confirming that a royalty rule covers its full date range."/>}
      </section>
    </div>}
  </>;
}

function Field({ label, value, onChange, type = "text", required = false, min, max, step }: { label: string; value: string; onChange(value: string): void; type?: string; required?: boolean; min?: string; max?: string; step?: string }) {
  return <label className="field"><span className="field-label">{label}{required ? " *" : ""}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} min={min} max={max} step={step}/></label>;
}
