"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, body, date, friendly, money, patch, unwrapItem, unwrapItems } from "./api";
import { Badge, Empty, Icon, Loading, Modal, Notice } from "./ui";

export type PayrollAppMode = "auto" | "manager" | "statements";

type PayrollPeriod = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
};

type PayrollComponent = {
  id?: string;
  componentType: string;
  description?: string | null;
  amountMinor: number | string;
  quantity?: string | null;
  rateMinor?: number | string | null;
};

type Calculation = {
  id: string;
  membershipId: string;
  version: number;
  grossAmountMinor: number | string;
  currency: string;
  calculatedAt?: string;
  calculationSnapshot?: {
    inputs?: Record<string, unknown>;
    formula?: Record<string, unknown>;
    corrections?: Array<{ description: string; amountMinor: number | string }>;
  };
  staff?: { name?: string | null; email?: string | null } | null;
  components?: PayrollComponent[];
};

type PayrollDetail = { period: PayrollPeriod; calculations: Calculation[] };

type PayrollProfile = {
  id: string;
  membershipId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  hourlyRateMinor?: number | string | null;
  overtimeConfiguration?: unknown;
  perJobConfiguration?: unknown;
  commissionConfiguration?: unknown;
  mileageRateMinorPerUnit?: number | string | null;
  bonusConfiguration?: unknown;
  currency?: string;
  staff?: { name?: string | null; email?: string | null } | null;
};

type StaffMember = { id: string; name: string; email?: string; role?: string; status?: string };
type Statement = { period: PayrollPeriod; calculation: Calculation; components: PayrollComponent[] };

export type PayrollProfileDraft = {
  membershipId: string;
  effectiveFrom: string;
  effectiveTo: string;
  hourlyDollars: string;
  overtimeAfterMinutes: string;
  overtimeMultiplier: string;
  perJobDollars: string;
  bonusDollars: string;
  completionBonusDollars: string;
  commissionPercent: string;
  mileageDollarsPerMile: string;
  currency: string;
};

function dollarsToMinor(value: string, allowNegative = false): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Enter an amount with up to two decimal places.");
  const amount = Number(text);
  if (!Number.isFinite(amount) || (!allowNegative && amount < 0)) throw new Error("Enter a valid non-negative amount.");
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor)) throw new Error("That amount is too large.");
  return minor;
}

function configRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asOptionalNumber(value: string, label: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be zero or greater.`);
  return parsed;
}

export function buildPayrollProfilePayload(draft: PayrollProfileDraft, includeMembership = true) {
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Enter a three-letter currency code, such as USD.");
  if (!draft.effectiveFrom) throw new Error("Choose when this pay profile starts.");
  if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) throw new Error("The end date must be on or after the start date.");

  const afterMinutes = asOptionalNumber(draft.overtimeAfterMinutes, "The overtime threshold");
  const multiplier = asOptionalNumber(draft.overtimeMultiplier, "The overtime rate");
  if ((afterMinutes === undefined) !== (multiplier === undefined)) {
    throw new Error("Enter both the overtime threshold and overtime rate, or leave both blank.");
  }
  if (afterMinutes !== undefined && (!Number.isInteger(afterMinutes) || multiplier! <= 0)) {
    throw new Error("Use a whole-minute overtime threshold and a rate above zero.");
  }

  const commissionPercent = asOptionalNumber(draft.commissionPercent, "The commission rate");
  if (commissionPercent !== undefined && commissionPercent > 100) throw new Error("Commission rate cannot exceed 100%.");

  const payload: Record<string, unknown> = {
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo || null,
    hourlyRateMinor: dollarsToMinor(draft.hourlyDollars),
    overtimeConfiguration: afterMinutes === undefined ? {} : { afterMinutes, multiplier },
    perJobConfiguration: { amountMinor: dollarsToMinor(draft.perJobDollars) ?? 0 },
    commissionConfiguration: { rateBasisPoints: Math.round((commissionPercent ?? 0) * 100) },
    mileageRateMinorPerUnit: dollarsToMinor(draft.mileageDollarsPerMile),
    bonusConfiguration: {
      amountMinor: dollarsToMinor(draft.bonusDollars) ?? 0,
      completionBonusMinor: dollarsToMinor(draft.completionBonusDollars) ?? 0,
    },
    currency,
  };
  if (includeMembership) payload.membershipId = draft.membershipId;
  else if (draft.membershipId) throw new Error("A staff member cannot be changed on an existing pay profile.");
  if (includeMembership && !draft.membershipId) throw new Error("Choose a staff member.");
  return payload;
}

export function buildPayrollCorrectionPayload(membershipId: string, amountDollars: string, description: string) {
  const amountMinor = dollarsToMinor(amountDollars, true);
  if (amountMinor === null || amountMinor === 0) throw new Error("Enter a correction amount other than zero.");
  const label = description.trim();
  if (label.length < 3 || label.length > 200) throw new Error("Describe the correction in 3 to 200 characters.");
  return { membershipId, amountMinor, description: label };
}

function minorToDollars(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? (amount / 100).toFixed(2) : "";
}

function initialProfileDraft(profile?: PayrollProfile | null): PayrollProfileDraft {
  const overtime = configRecord(profile?.overtimeConfiguration);
  const perJob = configRecord(profile?.perJobConfiguration);
  const bonus = configRecord(profile?.bonusConfiguration);
  const commission = configRecord(profile?.commissionConfiguration);
  return {
    membershipId: profile?.membershipId ?? "",
    effectiveFrom: profile?.effectiveFrom ?? localDateInput(),
    effectiveTo: profile?.effectiveTo ?? "",
    hourlyDollars: profile?.hourlyRateMinor == null ? "" : minorToDollars(profile.hourlyRateMinor),
    overtimeAfterMinutes: overtime.afterMinutes == null ? "" : String(overtime.afterMinutes),
    overtimeMultiplier: overtime.multiplier == null ? "" : String(overtime.multiplier),
    perJobDollars: minorToDollars(perJob.amountMinor ?? perJob.perJobMinor ?? 0),
    bonusDollars: minorToDollars(bonus.amountMinor ?? bonus.bonusMinor ?? 0),
    completionBonusDollars: minorToDollars(bonus.completionBonusMinor ?? 0),
    commissionPercent: commission.rateBasisPoints == null ? "" : (Number(commission.rateBasisPoints) / 100).toString(),
    mileageDollarsPerMile: profile?.mileageRateMinorPerUnit == null ? "" : minorToDollars(profile.mileageRateMinorPerUnit),
    currency: profile?.currency ?? "USD",
  };
}

function errorMessage(issue: unknown): string {
  return issue instanceof Error ? issue.message : "Something went wrong. Please try again.";
}

function isAccessError(issue: unknown): boolean {
  return /do not have access|not authorized|forbidden|staff access is required|permission/i.test(errorMessage(issue));
}

function accessCopy(action: string) {
  return `Your account does not have access to ${action}. Ask an owner to review your payroll access.`;
}

function latestCalculations(calculations: Calculation[]): Calculation[] {
  const latest = new Map<string, Calculation>();
  for (const calculation of calculations) {
    const current = latest.get(calculation.membershipId);
    if (!current || Number(calculation.version) > Number(current.version)) latest.set(calculation.membershipId, calculation);
  }
  return [...latest.values()].sort((a, b) => (a.staff?.name ?? a.membershipId).localeCompare(b.staff?.name ?? b.membershipId));
}

function periodLabel(period: PayrollPeriod) {
  return `${payrollDate(period.periodStart)} – ${payrollDate(period.periodEnd)}`;
}

function localDateInput(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function payrollDate(value?: string | null) {
  if (!value) return "Not scheduled";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function amountForCalculation(calculation: Calculation) {
  return money(Number(calculation.grossAmountMinor), calculation.currency || "USD");
}

function shortHours(minutes: unknown) {
  const parsed = Number(minutes);
  return Number.isFinite(parsed) ? `${(parsed / 60).toFixed(2)} hrs` : "—";
}

export default function PayrollApp({ mode = "auto", canManageProfiles }: { mode?: PayrollAppMode; canManageProfiles?: boolean }) {
  const [view, setView] = useState<"loading" | "manager" | "statements" | "blocked">("loading");
  const [tab, setTab] = useState<"periods" | "profiles">("periods");
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [detail, setDetail] = useState<PayrollDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [profiles, setProfiles] = useState<PayrollProfile[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffRole, setStaffRole] = useState("");
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileAccessError, setProfileAccessError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accessNotice, setAccessNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [denied, setDenied] = useState<Set<string>>(() => new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<PayrollProfile | null | undefined>(undefined);
  const [correctionTarget, setCorrectionTarget] = useState<Calculation | null>(null);
  const [periodStart, setPeriodStart] = useState(() => localDateInput(-13));
  const [periodEnd, setPeriodEnd] = useState(() => localDateInput());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    setAccessNotice("");
    setProfileAccessError("");
    setStaffRole("");
    const loadStatements = async (fallback: boolean) => {
      const result = await api<{ items?: Statement[] }>("/payroll/statements");
      if (!active) return;
      setStatements(unwrapItems(result));
      setView("statements");
      if (fallback) setAccessNotice("Your account can view approved personal statements. Payroll period management is limited to accounts with payroll access.");
    };
    const load = async () => {
      if (mode === "statements") {
        try { await loadStatements(false); }
        catch (issue) { if (active) { setView("blocked"); setLoadError(isAccessError(issue) ? accessCopy("your personal pay statements") : errorMessage(issue)); } }
        finally { if (active) setLoading(false); }
        return;
      }
      try {
        const result = await api<{ items?: PayrollPeriod[] }>("/payroll/periods");
        if (!active) return;
        const nextPeriods = unwrapItems(result);
        setPeriods(nextPeriods);
        setSelectedPeriodId((current) => nextPeriods.some((item) => item.id === current) ? current : nextPeriods[0]?.id ?? "");
        setView("manager");
        const [profilesResult, staffResult, identityResult] = await Promise.allSettled([
          api<{ items?: PayrollProfile[] }>("/payroll/profiles"),
          api<{ items?: StaffMember[] }>("/staff"),
          api<{ user?: { role?: string } }>("/auth/me"),
        ]);
        if (!active) return;
        if (profilesResult.status === "fulfilled") setProfiles(unwrapItems(profilesResult.value));
        else {
          setProfiles([]);
          setProfileAccessError(isAccessError(profilesResult.reason) ? accessCopy("compensation profiles") : errorMessage(profilesResult.reason));
        }
        if (staffResult.status === "fulfilled") setStaff(unwrapItems(staffResult.value));
        else setStaff([]);
        if (identityResult.status === "fulfilled") setStaffRole(identityResult.value.user?.role ?? "");
      } catch (issue) {
        if (!active) return;
        if (mode === "auto" && isAccessError(issue)) {
          try { await loadStatements(true); }
          catch (statementIssue) {
            if (active) { setView("blocked"); setLoadError(isAccessError(statementIssue) ? accessCopy("payroll periods or personal statements") : errorMessage(statementIssue)); }
          }
        } else {
          setView("blocked");
          setLoadError(isAccessError(issue) ? accessCopy("payroll periods") : errorMessage(issue));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [mode, reloadKey]);

  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId) ?? periods[0] ?? null;

  useEffect(() => {
    let active = true;
    if (view !== "manager" || tab !== "periods" || !selectedPeriod) {
      setDetail(null);
      return () => { active = false; };
    }
    setDetailLoading(true);
    api<{ item?: PayrollDetail } | PayrollDetail>(`/payroll/periods/${selectedPeriod.id}`)
      .then((result) => { if (active) setDetail(unwrapItem(result)); })
      .catch((issue) => { if (active) setError(isAccessError(issue) ? accessCopy("payroll calculation details") : errorMessage(issue)); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [view, tab, selectedPeriod?.id, reloadKey]);

  const latest = useMemo(() => latestCalculations(detail?.calculations ?? []), [detail?.calculations]);
  const grossByCurrency = latest.reduce((totals, calculation) => {
    const currency = calculation.currency || "USD";
    totals.set(currency, (totals.get(currency) ?? 0) + Number(calculation.grossAmountMinor || 0));
    return totals;
  }, new Map<string, number>());
  const grossSummary = latest.length === 0 ? "Not calculated" : grossByCurrency.size > 1
    ? `${grossByCurrency.size} currencies`
    : money([...grossByCurrency.values()][0] ?? 0, [...grossByCurrency.keys()][0] || profiles.find((profile) => profile.currency)?.currency || "USD");
  const profileManagementAllowed = canManageProfiles ?? (staffRole ? staffRole !== "office" && staffRole !== "technician" : true);

  function refresh() {
    setReloadKey((current) => current + 1);
  }

  async function runAction(label: string, action: () => Promise<void>, success?: string) {
    setBusy(label);
    setError("");
    setNotice("");
    setAccessNotice("");
    try {
      await action();
      if (success) setNotice(success);
      refresh();
    } catch (issue) {
      if (isAccessError(issue)) {
        setDenied((current) => new Set(current).add(label));
        setError(accessCopy(label === "profiles" ? "compensation profiles" : label.toLowerCase()));
      } else setError(errorMessage(issue));
    } finally {
      setBusy("");
    }
  }

  async function createPeriod(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("create period", async () => {
      const result = unwrapItem(await api<{ item: PayrollPeriod } | PayrollPeriod>("/payroll/periods", body({ periodStart, periodEnd })));
      setSelectedPeriodId(result.id);
      setPeriodModalOpen(false);
      setTab("periods");
    }, "Pay period created. Calculate gross pay when the time and job inputs are ready.");
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>, draft: PayrollProfileDraft) {
    event.preventDefault();
    await runAction("profiles", async () => {
      const payload = buildPayrollProfilePayload(draft, !profileTarget);
      if (profileTarget) await api(`/payroll/profiles/${profileTarget.id}`, patch(payload));
      else await api("/payroll/profiles", body(payload));
      setProfileTarget(undefined);
    }, profileTarget ? "Compensation profile updated." : "Compensation profile added.");
  }

  async function saveCorrection(event: React.FormEvent<HTMLFormElement>, amountDollars: string, description: string) {
    event.preventDefault();
    if (!selectedPeriod || !correctionTarget) return;
    await runAction("corrections", async () => {
      await api(`/payroll/periods/${selectedPeriod.id}/corrections`, body(buildPayrollCorrectionPayload(correctionTarget.membershipId, amountDollars, description)));
      setCorrectionTarget(null);
    }, "Correction saved as a new calculation version.");
  }

  async function periodAction(action: "calculate" | "review" | "approve" | "reopen") {
    if (!selectedPeriod) return;
    const label = action === "calculate" ? "calculate pay" : action === "review" ? "send for review" : action === "approve" ? "approve payroll" : "reopen the period";
    await runAction(label, async () => {
      if (action === "calculate") await api(`/payroll/periods/${selectedPeriod.id}/calculate`, body({}));
      else await api(`/payroll/periods/${selectedPeriod.id}`, patch({ action }));
    }, action === "calculate" ? "Gross pay calculated from the approved inputs." : action === "review" ? "Pay period sent for review." : action === "approve" ? "Pay period approved." : "Pay period reopened.");
  }

  async function exportCsv() {
    if (!selectedPeriod) return;
    await runAction("export CSV", async () => {
      const response = await fetch(`/api/v1/payroll/periods/${selectedPeriod.id}/export`, { method: "POST", credentials: "include", cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || `We couldn’t export this pay period (${response.status}). Please try again.`);
      }
      const file = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `payroll-${selectedPeriod.periodStart}-${selectedPeriod.periodEnd}.csv`;
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }, "Gross pay CSV downloaded.");
  }

  if (loading || view === "loading") return <Loading label="Loading payroll workspace…"/>;

  if (view === "blocked") return <>
    <PayrollHeader title="Payroll" subtitle="Review gross pay and approved pay statements."/>
    <div className="card card-pad"><Empty title="Payroll access is limited" description={loadError || "Your account cannot open this payroll information."}/></div>
  </>;

  if (view === "statements") return <>
    <PayrollHeader title="Your pay statements" subtitle="Review gross pay from periods approved by your business."/>
    {accessNotice && <div style={{ marginBottom: 16 }}><Notice text={accessNotice}/></div>}
    {error && <div style={{ marginBottom: 16 }}><Notice kind="error" text={error}/></div>}
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="inline-actions" style={{ alignItems: "flex-start" }}><span className="module-icon"><Icon name="receipt"/></span><div><strong>Gross pay statement</strong><p className="subtle" style={{ margin: "4px 0 0", fontSize: ".85rem" }}>Amounts summarize approved pay inputs. This workspace does not file taxes or send payments.</p></div></div>
    </div>
    {loading ? <Loading/> : statements.length ? <div className="stack">{statements.map((statement) => <StatementCard key={`${statement.period.id}-${statement.calculation.version}`} statement={statement}/>)}</div> : <div className="card"><Empty title="No approved statements yet" description="Your approved gross pay statements will appear here after a payroll period is approved."/> </div>}
  </>;

  return <>
    <PayrollHeader title="Payroll" subtitle="Review pay inputs, confirm gross pay, and export an approved period.">
      {tab === "periods" && !denied.has("create period") && <button type="button" className="btn btn-primary" onClick={() => setPeriodModalOpen(true)}><Icon name="plus" size={16}/> New pay period</button>}
      {tab === "profiles" && profileManagementAllowed && !denied.has("profiles") && <button type="button" className="btn btn-primary" disabled={!!profileAccessError || !staff.length} onClick={() => setProfileTarget(null)}><Icon name="plus" size={16}/> Add pay profile</button>}
    </PayrollHeader>

    {accessNotice && <div style={{ marginBottom: 16 }}><Notice text={accessNotice}/></div>}
    {notice && <div style={{ marginBottom: 16 }}><Notice kind="success" text={notice} onClose={() => setNotice("")}/></div>}
    {error && <div style={{ marginBottom: 16 }}><Notice kind="error" text={error}/></div>}

    <div className="report-tabs" role="tablist" aria-label="Payroll areas" style={{ marginBottom: 22 }}>
      <button type="button" role="tab" aria-selected={tab === "periods"} className={tab === "periods" ? "active" : ""} onClick={() => setTab("periods")}><Icon name="calendar" size={16}/> Pay periods</button>
      <button type="button" role="tab" aria-selected={tab === "profiles"} className={tab === "profiles" ? "active" : ""} onClick={() => setTab("profiles")}><Icon name="person" size={16}/> Compensation</button>
    </div>

    {tab === "profiles" ? <ProfilesPanel profiles={profiles} staff={staff} loading={loading} accessError={profileAccessError} canManage={profileManagementAllowed && !denied.has("profiles")} onEdit={(profile) => setProfileTarget(profile)}/>
      : <>
        <div className="four-col" style={{ marginBottom: 21 }}>
          <PayrollMetric icon="calendar" label="Pay periods" value={String(periods.length)} hint="In this workspace"/>
          <PayrollMetric icon="person" label="Staff in selected period" value={String(latest.length)} hint={selectedPeriod ? periodLabel(selectedPeriod) : "Choose a period"}/>
          <PayrollMetric icon="wallet" label="Current gross pay" value={grossSummary} hint={grossByCurrency.size > 1 ? "Amounts shown in each person’s currency" : "Latest calculation for each person"}/>
          <PayrollMetric icon="receipt" label="Period status" value={friendly(selectedPeriod?.status)} hint="Review before approval"/>
        </div>

        {!periods.length ? <div className="card"><Empty title="No pay periods yet" description="Create a date range, then calculate gross pay from approved time, job, mileage, and tip inputs." action={!denied.has("create period") ? <button type="button" className="btn btn-primary btn-sm" onClick={() => setPeriodModalOpen(true)}>Create pay period</button> : undefined}/></div> : <div className="two-col" style={{ gridTemplateColumns: "minmax(230px,.8fr) minmax(0,1.8fr)", alignItems: "start" }}>
          <div className="card card-pad">
            <div className="card-heading"><h2>Pay periods</h2><span className="muted-label">{periods.length} total</span></div>
            <div className="stack" style={{ gap: 8 }}>
              {periods.map((period) => <button key={period.id} type="button" className="card" onClick={() => setSelectedPeriodId(period.id)} aria-current={period.id === selectedPeriod?.id ? "true" : undefined} style={{ textAlign: "left", padding: "13px 14px", borderColor: period.id === selectedPeriod?.id ? "#83b96f" : "var(--line)", boxShadow: period.id === selectedPeriod?.id ? "0 0 0 3px rgba(130,185,105,.14)" : "none", cursor: "pointer" }}><span className="table-primary">{periodLabel(period)}</span><span className="inline-actions" style={{ justifyContent: "space-between", marginTop: 8 }}><Badge status={period.status}/><span className="subtle" style={{ fontSize: ".75rem" }}>Open period</span></span></button>)}
            </div>
          </div>
          <section className="card card-pad" aria-label="Selected payroll period">
            {!selectedPeriod ? <Empty title="Choose a pay period" description="Select a period to review its calculation and actions."/> : <>
              <div className="card-heading" style={{ alignItems: "flex-start" }}><div><div className="eyebrow">Selected pay period</div><h2 style={{ margin: "4px 0 5px" }}>{periodLabel(selectedPeriod)}</h2><div className="inline-actions"><Badge status={selectedPeriod.status}/><span className="subtle" style={{ fontSize: ".8rem" }}>Gross pay only</span></div></div>
                <div className="inline-actions">
                  {isOpenPeriod(selectedPeriod.status) && !denied.has("calculate pay") && <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => void periodAction("calculate")}><Icon name="refresh" size={15}/>{latest.length ? "Recalculate" : "Calculate pay"}</button>}
                  {isOpenPeriod(selectedPeriod.status) && latest.length > 0 && !denied.has("send for review") && <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void periodAction("review")}><Icon name="check" size={15}/> Send for review</button>}
                  {selectedPeriod.status === "reviewed" && !denied.has("approve payroll") && <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void periodAction("approve")}><Icon name="check" size={15}/> Approve</button>}
                  {(selectedPeriod.status === "reviewed" || selectedPeriod.status === "approved") && !denied.has("reopen the period") && <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => void periodAction("reopen")}>Reopen</button>}
                  {(selectedPeriod.status === "approved" || selectedPeriod.status === "exported") && !denied.has("export CSV") && <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => void exportCsv()}><Icon name="download" size={15}/> Export CSV</button>}
                </div>
              </div>
              <Notice text="The calculation uses approved time, completed jobs, mileage, and recorded tips for these dates. The CSV contains gross pay amounts; it does not file taxes or send payments."/>
              {detailLoading ? <Loading label="Loading calculation details…"/> : detail ? <>
                {latest.length ? <div className="payroll-staff-list" style={{ marginTop: 17 }}>
                  {latest.map((calculation) => <CalculationCard key={calculation.membershipId} calculation={calculation} history={detail.calculations.filter((item) => item.membershipId === calculation.membershipId)} canCorrect={isOpenPeriod(selectedPeriod.status)} disabled={!!busy || denied.has("corrections")} onCorrect={() => setCorrectionTarget(calculation)}/>)}
                </div> : <Empty title="No gross pay calculated" description="Calculate this period to gather approved time, completed work, mileage, and tips into a reviewable gross pay total."/>}
              </> : <Notice kind="error" text="We couldn’t load the calculation details. Refresh the page or choose this period again."/>}
            </>}
          </section>
        </div>}
      </>}

    {periodModalOpen && <PeriodEditor start={periodStart} end={periodEnd} busy={busy === "create period"} onChangeStart={setPeriodStart} onChangeEnd={setPeriodEnd} onClose={() => setPeriodModalOpen(false)} onSubmit={createPeriod}/>}
    {profileTarget !== undefined && <ProfileEditor key={profileTarget?.id ?? "new-profile"} profile={profileTarget} staff={staff} busy={busy === "profiles"} error={error} onClose={() => setProfileTarget(undefined)} onSubmit={saveProfile}/>}
    {correctionTarget && <CorrectionEditor key={correctionTarget.id} calculation={correctionTarget} busy={busy === "corrections"} error={error} onClose={() => setCorrectionTarget(null)} onSubmit={saveCorrection}/>}
  </>;
}

function isOpenPeriod(status: string) {
  return status === "open" || status === "reopened";
}

function PayrollHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return <div className="page-head"><div><div className="eyebrow">Staff</div><h1>{title}</h1><p>{subtitle}</p></div>{children && <div className="page-actions">{children}</div>}</div>;
}

function PayrollMetric({ icon, label, value, hint }: { icon: "calendar" | "person" | "wallet" | "receipt"; label: string; value: string; hint: string }) {
  return <div className="card metric-card"><div className="metric-icon"><Icon name={icon} size={17}/></div><div className="muted-label">{label}</div><div className="metric-value amount" style={{ fontSize: value.length > 15 ? "1.15rem" : undefined }}>{value}</div><div className="metric-hint">{hint}</div></div>;
}

function ProfilesPanel({ profiles, staff, loading, accessError, canManage, onEdit }: { profiles: PayrollProfile[]; staff: StaffMember[]; loading: boolean; accessError: string; canManage: boolean; onEdit: (profile: PayrollProfile) => void }) {
  const names = new Map(staff.map((person) => [person.id, person.name]));
  const ordered = [...profiles].sort((a, b) => (names.get(a.membershipId) ?? a.staff?.name ?? "").localeCompare(names.get(b.membershipId) ?? b.staff?.name ?? "") || b.effectiveFrom.localeCompare(a.effectiveFrom));
  if (loading) return <div className="card"><Loading label="Loading compensation profiles…"/></div>;
  if (accessError) return <div className="card card-pad"><Empty title="Pay profiles are unavailable" description={accessError}/></div>;
  return <>
    <div className="card card-pad" style={{ marginBottom: 18 }}><div className="inline-actions" style={{ alignItems: "flex-start" }}><span className="module-icon"><Icon name="person"/></span><div><strong>Pay profiles</strong><p className="subtle" style={{ margin: "4px 0 0", fontSize: ".85rem" }}>Set an effective date range and the pay inputs used for future gross pay calculations. Recorded tips are included when available.</p></div></div></div>
    {!canManage && <div style={{ marginBottom: 16 }}><Notice text="You can review compensation profiles. An owner manages profile changes."/></div>}
    {ordered.length ? <div className="card"><div className="data-table-wrap"><table className="data-table" style={{ minWidth: 760 }}><thead><tr><th>Staff member</th><th>Pay inputs</th><th>Effective dates</th><th>Currency</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{ordered.map((profile) => <tr key={profile.id}><td><span className="table-primary">{names.get(profile.membershipId) || profile.staff?.name || "Team member"}</span><span className="table-secondary">{profile.staff?.email || staff.find((person) => person.id === profile.membershipId)?.email || ""}</span></td><td>{profileSummary(profile)}</td><td>{payrollDate(profile.effectiveFrom)} – {profile.effectiveTo ? payrollDate(profile.effectiveTo) : "Ongoing"}</td><td>{profile.currency || "USD"}</td><td>{canManage && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(profile)}>Edit</button>}</td></tr>)}</tbody></table></div>
      <div className="table-card-fallback">{ordered.map((profile) => <div className="table-card" key={profile.id}><strong>{names.get(profile.membershipId) || profile.staff?.name || "Team member"}</strong><p className="subtle">{profileSummary(profile)} · {profile.currency || "USD"}</p><p className="subtle">{payrollDate(profile.effectiveFrom)} – {profile.effectiveTo ? payrollDate(profile.effectiveTo) : "Ongoing"}</p>{canManage && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(profile)}>Edit pay profile</button>}</div>)}</div>
    </div> : <div className="card"><Empty title="No compensation profiles" description="Create a profile before calculating gross pay for staff with approved payroll inputs."/></div>}
  </>;
}

function profileSummary(profile: PayrollProfile) {
  const pieces: string[] = [];
  if (profile.hourlyRateMinor != null) pieces.push(`${money(Number(profile.hourlyRateMinor), profile.currency || "USD")}/hr`);
  const perJob = configRecord(profile.perJobConfiguration);
  if (Number(perJob.amountMinor ?? perJob.perJobMinor ?? 0) > 0) pieces.push(`${money(Number(perJob.amountMinor ?? perJob.perJobMinor), profile.currency || "USD")}/job`);
  const bonus = configRecord(profile.bonusConfiguration);
  if (Number(bonus.amountMinor ?? bonus.bonusMinor ?? 0) > 0) pieces.push("period bonus");
  if (Number(bonus.completionBonusMinor ?? 0) > 0) pieces.push("completion bonus");
  const commission = configRecord(profile.commissionConfiguration);
  if (Number(commission.rateBasisPoints ?? 0) > 0) pieces.push(`${(Number(commission.rateBasisPoints) / 100).toFixed(2)}% commission`);
  if (profile.mileageRateMinorPerUnit != null) pieces.push(`${money(Number(profile.mileageRateMinorPerUnit), profile.currency || "USD")}/mile`);
  return pieces.length ? pieces.join(" · ") : "No pay inputs set";
}

function CalculationCard({ calculation, history, canCorrect, disabled, onCorrect }: { calculation: Calculation; history: Calculation[]; canCorrect: boolean; disabled: boolean; onCorrect: () => void }) {
  const inputs = calculation.calculationSnapshot?.inputs ?? {};
  const previous = history.filter((item) => item.id !== calculation.id).sort((a, b) => Number(b.version) - Number(a.version));
  return <article className="card card-pad" style={{ marginBottom: 12 }}>
    <div className="card-heading" style={{ marginBottom: 12 }}><div><strong>{calculation.staff?.name || "Team member"}</strong><div className="table-secondary">{calculation.staff?.email || ""}</div></div><div className="inline-actions"><Badge status={`version ${calculation.version}`}/><span className="amount" style={{ fontSize: "1.15rem" }}>{amountForCalculation(calculation)}</span></div></div>
    <div className="inline-actions" style={{ gap: 18, color: "var(--muted)", fontSize: ".8rem", marginBottom: 13 }}><span>{shortHours(inputs.approvedMinutes)} paid time</span><span>{Number(inputs.completedJobCount ?? 0)} completed jobs</span><span>{(Number(inputs.mileageTenths ?? 0) / 10).toFixed(1)} reimbursable miles</span><span>{Number(inputs.tipsMinor ?? 0) ? `${money(Number(inputs.tipsMinor), calculation.currency)} tips` : "Tips included when recorded"}</span></div>
    <details><summary className="table-action" style={{ cursor: "pointer" }}>View pay breakdown and inputs</summary><div style={{ marginTop: 12 }}>
      {calculation.components?.length ? <div className="data-table-wrap"><table className="data-table" style={{ minWidth: 520 }}><thead><tr><th>Pay input</th><th>Details</th><th>Gross pay</th></tr></thead><tbody>{calculation.components.map((component, index) => <tr key={component.id ?? `${component.componentType}-${index}`}><td>{friendly(component.componentType)}</td><td>{component.description || "—"}{component.quantity ? <span className="table-secondary">Quantity: {component.quantity}{component.rateMinor != null ? ` · Rate: ${money(Number(component.rateMinor), calculation.currency)}` : ""}</span> : null}</td><td>{money(Number(component.amountMinor), calculation.currency)}</td></tr>)}</tbody></table></div> : <p className="subtle" style={{ fontSize: ".83rem" }}>No detailed input breakdown is available for this calculation.</p>}
      <div className="inline-actions" style={{ marginTop: 11, fontSize: ".78rem", color: "var(--muted)" }}><span>Approved time: {shortHours(inputs.approvedMinutes)}</span><span>Jobs: {Number(inputs.completedJobCount ?? 0)}</span><span>Completed work value: {money(Number(inputs.completedRevenueMinor ?? 0), calculation.currency)}</span></div>
    </div></details>
    {previous.length > 0 && <details style={{ marginTop: 10 }}><summary className="table-action" style={{ cursor: "pointer" }}>Earlier calculation versions ({previous.length})</summary><div className="stack" style={{ marginTop: 10, gap: 7 }}>{previous.map((item) => <div className="inline-actions" key={item.id} style={{ justifyContent: "space-between", padding: "9px 11px", background: "#f8faf7", borderRadius: 9, fontSize: ".8rem" }}><span>Version {item.version}{item.calculatedAt ? ` · ${date(item.calculatedAt)}` : ""}</span><strong>{amountForCalculation(item)}</strong></div>)}</div></details>}
    <div className="inline-actions" style={{ justifyContent: "flex-end", marginTop: 12 }}>
      {canCorrect && <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={onCorrect}>Add correction</button>}
    </div>
  </article>;
}

function StatementCard({ statement }: { statement: Statement }) {
  return <article className="card card-pad"><div className="card-heading" style={{ marginBottom: 14 }}><div><div className="eyebrow">Approved statement</div><h2 style={{ margin: "4px 0" }}>{periodLabel(statement.period)}</h2></div><div style={{ textAlign: "right" }}><Badge status={statement.period.status}/><div className="amount" style={{ fontSize: "1.35rem", marginTop: 8 }}>{amountForCalculation(statement.calculation)}</div><span className="table-secondary">Gross pay · version {statement.calculation.version}</span></div></div>
    {statement.components.length ? <div className="stack" style={{ gap: 0 }}>{statement.components.map((component, index) => <div className="action-item" key={component.id ?? `${component.componentType}-${index}`}><div className="action-icon"><Icon name={component.componentType === "hourly" || component.componentType === "overtime" ? "time" : "wallet"} size={16}/></div><div style={{ flex: 1 }}><strong>{component.description || friendly(component.componentType)}</strong><p>{friendly(component.componentType)}{component.quantity ? ` · ${component.quantity}` : ""}</p></div><strong>{money(Number(component.amountMinor), statement.calculation.currency)}</strong></div>)}</div> : <p className="subtle" style={{ fontSize: ".85rem" }}>A line-by-line gross pay breakdown is not available for this statement.</p>}
    <div className="inline-actions" style={{ marginTop: 16 }}><Link className="btn btn-secondary btn-sm" href={`/app/documents/pay-statement/${statement.calculation.id}`}>View pay statement</Link></div>
  </article>;
}

function PeriodEditor({ start, end, busy, onChangeStart, onChangeEnd, onClose, onSubmit }: { start: string; end: string; busy: boolean; onChangeStart: (value: string) => void; onChangeEnd: (value: string) => void; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <Modal title="Create a pay period" onClose={onClose}><form onSubmit={onSubmit}><p className="subtle" style={{ marginTop: 0 }}>Choose the dates you want to gather for gross pay review.</p><div className="form-grid"><div className="field"><label htmlFor="pay-period-start">Start date</label><input id="pay-period-start" type="date" required value={start} onChange={(event) => onChangeStart(event.target.value)}/></div><div className="field"><label htmlFor="pay-period-end">End date</label><input id="pay-period-end" type="date" min={start} required value={end} onChange={(event) => onChangeEnd(event.target.value)}/></div></div><div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || end < start}>{busy ? "Creating…" : "Create pay period"}</button></div></form></Modal>;
}

function ProfileEditor({ profile, staff, busy, error, onClose, onSubmit }: { profile: PayrollProfile | null; staff: StaffMember[]; busy: boolean; error: string; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>, draft: PayrollProfileDraft) => void }) {
  const [draft, setDraft] = useState(() => initialProfileDraft(profile));
  const [formError, setFormError] = useState("");
  const eligibleStaff = staff.filter((person) => person.status !== "deactivated");
  const change = (key: keyof PayrollProfileDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return <Modal title={profile ? "Edit compensation profile" : "New compensation profile"} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); setFormError(""); try { buildPayrollProfilePayload(draft, !profile); onSubmit(event, draft); } catch (issue) { setFormError(errorMessage(issue)); } }}>
    <p className="subtle" style={{ marginTop: 0 }}>These pay inputs are used for future calculations that cover the effective dates.</p>
    <div className="form-grid">
      {!profile && <div className="field full"><label htmlFor="pay-profile-member">Staff member</label><select id="pay-profile-member" required value={draft.membershipId} onChange={(event) => change("membershipId", event.target.value)}><option value="">Choose a staff member</option>{eligibleStaff.map((person) => <option key={person.id} value={person.id}>{person.name}{person.role ? ` · ${friendly(person.role)}` : ""}</option>)}</select></div>}
      <div className="field"><label htmlFor="pay-profile-from">Effective from</label><input id="pay-profile-from" type="date" required value={draft.effectiveFrom} onChange={(event) => change("effectiveFrom", event.target.value)}/></div>
      <div className="field"><label htmlFor="pay-profile-to">Effective through</label><input id="pay-profile-to" type="date" min={draft.effectiveFrom} value={draft.effectiveTo} onChange={(event) => change("effectiveTo", event.target.value)}/><small>Leave blank for an ongoing profile.</small></div>
      <div className="field"><label htmlFor="pay-profile-hourly">Hourly rate</label><input id="pay-profile-hourly" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Optional" value={draft.hourlyDollars} onChange={(event) => change("hourlyDollars", event.target.value)}/></div>
      <div className="field"><label htmlFor="pay-profile-job">Amount per completed job</label><input id="pay-profile-job" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={draft.perJobDollars} onChange={(event) => change("perJobDollars", event.target.value)}/></div>
      <div className="field"><label htmlFor="pay-profile-bonus">Flat period bonus</label><input id="pay-profile-bonus" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={draft.bonusDollars} onChange={(event) => change("bonusDollars", event.target.value)}/></div>
      <div className="field"><label htmlFor="pay-profile-completion">Bonus per completed job</label><input id="pay-profile-completion" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={draft.completionBonusDollars} onChange={(event) => change("completionBonusDollars", event.target.value)}/></div>
      <div className="field"><label htmlFor="pay-profile-commission">Commission rate</label><input id="pay-profile-commission" type="number" min="0" max="100" step="0.01" inputMode="decimal" placeholder="Optional" value={draft.commissionPercent} onChange={(event) => change("commissionPercent", event.target.value)}/><small>Percent of completed job value.</small></div>
      <div className="field"><label htmlFor="pay-profile-mileage">Mileage reimbursement per mile</label><input id="pay-profile-mileage" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Optional" value={draft.mileageDollarsPerMile} onChange={(event) => change("mileageDollarsPerMile", event.target.value)}/></div>
      <div className="field"><label htmlFor="pay-profile-overtime-after">Overtime after (minutes)</label><input id="pay-profile-overtime-after" type="number" min="0" step="1" placeholder="Optional" value={draft.overtimeAfterMinutes} onChange={(event) => change("overtimeAfterMinutes", event.target.value)}/></div>
      <div className="field"><label htmlFor="pay-profile-overtime-rate">Overtime multiplier</label><input id="pay-profile-overtime-rate" type="number" min="0.01" step="0.01" placeholder="e.g. 1.5" value={draft.overtimeMultiplier} onChange={(event) => change("overtimeMultiplier", event.target.value)}/></div>
      <div className="field"><label htmlFor="pay-profile-currency">Currency</label><input id="pay-profile-currency" type="text" maxLength={3} autoCapitalize="characters" value={draft.currency} onChange={(event) => change("currency", event.target.value)}/></div>
    </div>
    {(formError || error) && <div style={{ marginTop: 15 }}><Notice kind="error" text={formError || error}/></div>}
    <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || (!profile && !eligibleStaff.length)}>{busy ? "Saving…" : profile ? "Save pay profile" : "Create pay profile"}</button></div>
  </form></Modal>;
}

function CorrectionEditor({ calculation, busy, error, onClose, onSubmit }: { calculation: Calculation; busy: boolean; error: string; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>, amount: string, description: string) => void }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  return <Modal title={`Correct ${calculation.staff?.name || "staff pay"}`} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); setFormError(""); try { buildPayrollCorrectionPayload(calculation.membershipId, amount, description); onSubmit(event, amount, description); } catch (issue) { setFormError(errorMessage(issue)); } }}>
    <p className="subtle" style={{ marginTop: 0 }}>Current gross pay is {amountForCalculation(calculation)}. The correction creates a new calculation version and keeps the earlier version for review.</p>
    <div className="form-grid"><div className="field"><label htmlFor="pay-correction-amount">Correction amount ({calculation.currency})</label><input id="pay-correction-amount" type="number" step="0.01" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)}/><small>Use a negative amount to reduce gross pay. Gross pay cannot go below zero.</small></div><div className="field"><label htmlFor="pay-correction-description">Reason</label><input id="pay-correction-description" type="text" minLength={3} maxLength={200} required value={description} onChange={(event) => setDescription(event.target.value)}/></div></div>
    {(formError || error) && <div style={{ marginTop: 15 }}><Notice kind="error" text={formError || error}/></div>}
    <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save correction"}</button></div>
  </form></Modal>;
}
