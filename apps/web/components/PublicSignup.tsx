"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, body, money, unwrapItem } from "./api";
import { Icon, Loading, Notice, useResource } from "./ui";

type PackField = { key: string; label: string; type: string; required?: boolean; sensitive?: boolean; options?: string[]; defaultValue?: string | number | boolean };
type PackAsset = { key: string; label: string; pluralLabel: string; fields: PackField[] };
type SignupIndustry = { formSteps?: Array<{ key: string; label: string; fields: string[] }>; locationFields?: PackField[]; assets?: PackAsset[]; recurrencePresets?: Array<{ key: string; label: string; rrule?: string; custom?: boolean }> };

function initialIndustryData(industry: SignupIndustry | undefined) {
  return {
    location: Object.fromEntries((industry?.locationFields ?? []).filter((field) => field.defaultValue !== undefined).map((field) => [field.key, field.defaultValue])),
    assets: Object.fromEntries((industry?.assets ?? []).map((asset) => [asset.key, [{}]])),
  } as { location: Record<string, unknown>; assets: Record<string, Record<string, unknown>[]> };
}

function PackFieldInput({ field, value, onChange, id }: { field: PackField; value: unknown; onChange: (value: unknown) => void; id: string }) {
  if (field.type === "boolean") return <div className="field full"><label className="checkbox-row" htmlFor={id}><input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)}/>{field.label}{field.required ? " *" : ""}</label></div>;
  const type = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return <div className="field"><label htmlFor={id}>{field.label}{field.required ? " *" : ""}</label>{field.type === "enum" ? <select id={id} required={field.required} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">Choose an option</option>{(field.options ?? []).map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select> : <input id={id} type={type} required={field.required} value={value === undefined || value === null ? "" : String(value)} onChange={(event) => onChange(field.type === "number" ? (event.target.value === "" ? undefined : Number(event.target.value)) : event.target.value)}/ >}{field.sensitive && <small>Only the assigned service team can view this.</small>}</div>;
}

export default function PublicSignup({ slug }: { slug: string }) {
  const siteResult = useResource<{ item: Record<string, any> }>(`/public/site?slug=${encodeURIComponent(slug)}`, { item: {} });
  const site = unwrapItem(siteResult.data);
  const industry = site.industryIntake as SignupIndustry | undefined;
  const [step, setStep] = useState(0); const [address, setAddress] = useState(""); const [zip, setZip] = useState(""); const [eligible, setEligible] = useState<boolean | null>(null); const [eligibilityMessage, setEligibilityMessage] = useState("");
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });
  const [serviceId, setServiceId] = useState(""); const [frequency, setFrequency] = useState("one_time"); const [industryData, setIndustryData] = useState(() => initialIndustryData(undefined)); const [requestDetails, setRequestDetails] = useState(""); const [preferredDay, setPreferredDay] = useState("");
  const [quote, setQuote] = useState<Record<string, any> | null>(null); const [quoteUnavailable, setQuoteUnavailable] = useState(false); const [terms, setTerms] = useState(false); const [demoPayment, setDemoPayment] = useState(false); const [result, setResult] = useState<Record<string, any> | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const idempotencyKey = useRef("");
  const services: Record<string, any>[] = site.services || [];
  const selectedService = services.find((service) => service.id === serviceId || service.key === serviceId);
  const presets = industry?.recurrencePresets ?? [];
  const firstPresetKey = presets[0]?.key;
  const serviceLocationTerm = site.serviceLocationTerm || "Service location";

  useEffect(() => { if (industry) setIndustryData(initialIndustryData(industry)); }, [site.industryPackKey, industry]);
  useEffect(() => {
    if (selectedService?.serviceType === "one_time" && frequency !== "one_time") setFrequency("one_time");
    else if (selectedService?.serviceType !== "one_time" && frequency === "one_time" && firstPresetKey) setFrequency(firstPresetKey);
  }, [selectedService?.serviceType, frequency, firstPresetKey]);

  function setLocationField(key: string, value: unknown) { setIndustryData((current) => ({ ...current, location: { ...current.location, [key]: value } })); }
  function setAssetField(assetKey: string, index: number, key: string, value: unknown) {
    setIndustryData((current) => {
      const rows = [...(current.assets[assetKey] ?? [{}])]; rows[index] = { ...(rows[index] ?? {}), [key]: value };
      return { ...current, assets: { ...current.assets, [assetKey]: rows } };
    });
  }
  function addAsset(assetKey: string) { setIndustryData((current) => ({ ...current, assets: { ...current.assets, [assetKey]: [...(current.assets[assetKey] ?? []), {}] } })); }
  function removeAsset(assetKey: string, index: number) { setIndustryData((current) => ({ ...current, assets: { ...current.assets, [assetKey]: (current.assets[assetKey] ?? []).filter((_, row) => row !== index) } })); }

  async function next(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (step === 0) { setBusy(true); try { const response = await api<{ item: { eligible?: boolean; message?: string } }>("/public/eligibility", body({ slug, address, zip })); const info = unwrapItem(response); setEligible(Boolean(info.eligible)); setEligibilityMessage(info.message || (info.eligible ? "Great! Your address is in our service area." : "We’ll review your address personally.")); setStep(1); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } return; }
    if (step === 1) { setStep(2); return; }
    if (step === 2) { if (!serviceId) { setError("Choose a service to continue."); return; } if (selectedService?.serviceType !== "one_time" && presets.length && !frequency) { setError("Choose a service schedule."); return; } setStep(3); return; }
    if (step === 3) { await getQuote(); return; }
    if (step === 4) await submit();
  }

  async function getQuote() {
    setBusy(true); setError(""); setQuoteUnavailable(false);
    try { const response = await api<{ item: Record<string, any> }>("/public/quote", body({ slug, address, zip, serviceId, serviceKey: selectedService?.key, frequency, industryData, requestDetails, preferredDay })); setQuote(unwrapItem(response)); }
    catch (issue) { setQuoteUnavailable(true); setError((issue as Error).message); }
    finally { setBusy(false); setStep(4); }
  }
  async function submit() {
    if (!terms) { setError("Please accept the service terms to continue."); return; }
    setBusy(true); setError(""); if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    try {
      const response = await api<{ item: Record<string, any> }>("/public/signup", body({ slug, address, zip, contact, service: { id: serviceId, key: selectedService?.key, frequency }, industryData, requestDetails, preferredDay, quoteId: quote?.id, paymentMethod: site.signupBehavior === "activate_recurring" && demoPayment && eligible && quote?.amountCents ? "demo" : undefined, notificationPreferences: { email: true, sms: true }, termsAccepted: terms, termsVersion: site.termsVersion || "v1", idempotencyKey: idempotencyKey.current }));
      setResult(unwrapItem(response)); setStep(5);
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }

  if (siteResult.loading) return <Loading label="Preparing your signup…"/>;
  if (siteResult.error) return <div className="auth-main" style={{ minHeight: "100vh" }}><div className="auth-box"><h1>Signup unavailable</h1><p>{siteResult.error}</p><Link href={`/site/${slug}`} className="btn btn-secondary">Back to website</Link></div></div>;
  const intakeSteps = industry?.formSteps ?? [];
  const serviceStepLabel = intakeSteps.find((item) => !["address", "contact", "service", "quote", "finish"].includes(item.key))?.label || "Tell us about the work";
  const detailStepLabel = intakeSteps.find((item) => item.fields.some((key) => industry?.locationFields?.some((field) => field.key === key)))?.label || `${serviceLocationTerm} details`;
  const headings = ["Where do you need service?", "How can we reach you?", site.terminology?.service || "Choose a service", serviceStepLabel, "Review your request"];
  const descriptions = ["Share the service location so the team can confirm coverage.", "We’ll use this to confirm your request and send updates.", "Choose an available service and schedule.", "Share the details that help the team prepare.", "Check everything below, then send it to the team."];

  return <div className="signup-page"><header className="signup-header"><Link href={`/site/${slug}`} className="site-brand"><span className="site-brand-icon"><Icon name="spark" size={22}/></span>{site.businessName || "Service team"}</Link></header><main className="signup-shell"><div className="card signup-panel">{step === 5 ? <div className="signup-success"><div className="empty-icon"><Icon name="check" size={27}/></div><div className="eyebrow">Request received</div><h1>{result?.kind === "customer" || result?.status === "active" ? "You’re all set!" : "Thanks, we’ll be in touch."}</h1><p className="subtle">{result?.message || (eligible ? "We’ve received your details and will confirm your next step soon." : "Your address needs a personal review. Our team will follow up with a quote.")}</p><div className="inline-actions" style={{ justifyContent: "center", marginTop: 22 }}><Link className="btn btn-primary" href="/login">Customer login</Link><Link className="btn btn-secondary" href={`/site/${slug}`}>Back to website</Link></div></div> : <><div className="eyebrow">Get started with {site.businessName || "our team"}</div><h1>{headings[step]}</h1><p>{descriptions[step]}</p><div className="signup-steps" aria-label={`Step ${step + 1} of 5`}>{Array.from({ length: 5 }, (_, index) => <span key={index} className={index <= step ? "done" : ""}/>)}</div>{error && <div style={{ marginBottom: 16 }}><Notice kind="error" text={error}/></div>}{eligibilityMessage && step > 0 && <div style={{ marginBottom: 15 }}><Notice kind={eligible ? "success" : "info"} text={eligibilityMessage}/></div>}
      <form onSubmit={next}>{step === 0 && <div className="form-grid"><div className="field full"><label htmlFor="signup-address">{serviceLocationTerm} street address</label><input id="signup-address" required autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="123 Main Street"/></div><div className="field"><label htmlFor="signup-zip">ZIP code</label><input id="signup-zip" required inputMode="numeric" autoComplete="postal-code" value={zip} onChange={(event) => setZip(event.target.value)} placeholder="30901"/></div></div>}
        {step === 1 && <div className="form-grid"><div className="field full"><label htmlFor="signup-name">Full name</label><input id="signup-name" required autoComplete="name" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })}/></div><div className="field"><label htmlFor="signup-email">Email</label><input id="signup-email" type="email" required autoComplete="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })}/></div><div className="field"><label htmlFor="signup-phone">Phone</label><input id="signup-phone" type="tel" required autoComplete="tel" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })}/></div></div>}
        {step === 2 && <div className="stack"><div className="form-grid"><div className="field"><label htmlFor="signup-service">{site.terminology?.service || "Service"}</label><select id="signup-service" required value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="">Choose a service</option>{services.map((service) => <option key={service.id || service.key} value={service.id || service.key}>{service.name}</option>)}</select></div><div className="field"><label htmlFor="signup-frequency">How often or when?</label><select id="signup-frequency" value={selectedService?.serviceType === "one_time" ? "one_time" : frequency} onChange={(event) => setFrequency(event.target.value)}><option value="one_time">One-time visit or request</option>{presets.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}</select></div></div>
          {(industry?.assets ?? []).map((asset) => <section className="card card-pad" style={{ boxShadow: "none" }} key={asset.key}><div className="card-heading"><h2>{asset.pluralLabel}</h2><button type="button" className="btn btn-secondary btn-sm" onClick={() => addAsset(asset.key)}><Icon name="plus" size={14}/> Add {asset.label.toLowerCase()}</button></div>{(industryData.assets[asset.key] ?? []).map((values, index) => <div className="form-grid" style={{ marginBottom: 14 }} key={`${asset.key}-${index}`}>{asset.fields.filter((field) => field.type !== "media").map((field) => <PackFieldInput key={field.key} id={`asset-${asset.key}-${index}-${field.key}`} field={field} value={values[field.key] ?? field.defaultValue} onChange={(value) => setAssetField(asset.key, index, field.key, value)}/>)}{(industryData.assets[asset.key] ?? []).length > 1 && <button type="button" className="btn btn-danger btn-sm" onClick={() => removeAsset(asset.key, index)}>Remove {asset.label.toLowerCase()}</button>}</div>)}</section>)}
          {!industry?.assets?.length && <div className="field full"><label htmlFor="request-details">What should the team know? (optional)</label><textarea id="request-details" maxLength={4000} value={requestDetails} onChange={(event) => setRequestDetails(event.target.value)} placeholder="Describe the request, project, or outcome you have in mind."/></div>}
        </div>}
        {step === 3 && <div className="stack">{(industry?.locationFields ?? []).filter((field) => field.type !== "media").length > 0 && <section className="card card-pad" style={{ boxShadow: "none" }}><h2>{detailStepLabel}</h2><div className="form-grid">{(industry?.locationFields ?? []).filter((field) => field.type !== "media").map((field) => <PackFieldInput key={field.key} id={`location-${field.key}`} field={field} value={industryData.location[field.key] ?? field.defaultValue} onChange={(value) => setLocationField(field.key, value)}/>)}</div></section>}<div className="form-grid"><div className="field"><label htmlFor="preferred-day">Preferred date or timing (optional)</label><input id="preferred-day" maxLength={80} value={preferredDay} onChange={(event) => setPreferredDay(event.target.value)} placeholder="For example, a Saturday in October"/></div><div className="field full"><label htmlFor="request-details">Anything else the team should know? (optional)</label><textarea id="request-details" maxLength={4000} value={requestDetails} onChange={(event) => setRequestDetails(event.target.value)} placeholder="Add timing, access arrangements, or other details. Avoid including access codes here."/></div></div></div>}
        {step === 4 && <div className="stack"><div className="quote-result"><div className="eyebrow">Your next step</div>{eligible && quote?.amountCents != null && !quote.quoteRequired ? <><strong>{money(quote.amountCents)}</strong><p style={{ margin: "4px 0 0", fontSize: ".85rem" }}>{quote.intervalLabel || "Estimated service price"}. We’ll confirm before service begins.</p></> : <><strong>{site.signupBehavior === "activate_recurring" ? "Personal quote" : "Request review"}</strong><p style={{ margin: "4px 0 0", fontSize: ".85rem" }}>{!eligible ? "Your location needs review. We’ll get back to you with options." : quoteUnavailable ? "We’ll review your details and follow up." : "We’ll review your request and send a clear next step."}</p></>}</div><div className="card card-pad" style={{ boxShadow: "none" }}><div className="detail-list"><dt>{serviceLocationTerm}</dt><dd>{address}, {zip}</dd></div><div className="detail-list"><dt>Service</dt><dd>{selectedService?.name || "Service"} · {presets.find((preset) => preset.key === frequency)?.label || "One time"}</dd></div>{requestDetails && <div className="detail-list"><dt>Request details</dt><dd>{requestDetails}</dd></div>}<div className="detail-list"><dt>Contact</dt><dd>{contact.name} · {contact.email}</dd></div></div>{site.signupBehavior === "activate_recurring" && eligible && quote?.amountCents != null && !quote.quoteRequired && <label className="checkbox-row"><input type="checkbox" checked={demoPayment} onChange={(event) => setDemoPayment(event.target.checked)}/>Use a demo payment method for local testing. No real charge will be made.</label>}<label className="checkbox-row"><input type="checkbox" checked={terms} required onChange={(event) => setTerms(event.target.checked)}/>I agree to be contacted about this request and accept the service terms.</label></div>}
        <div className="onboarding-footer">{step > 0 ? <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)}>Back</button> : <Link className="btn btn-secondary" href={`/site/${slug}`}>Back to website</Link>}<button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "One moment…" : step === 0 ? "Check availability" : step === 3 ? "See my price" : step === 4 ? "Send service request" : "Continue"} <Icon name="arrow" size={16}/></button></div>
      </form></>}</div></main></div>;
}
