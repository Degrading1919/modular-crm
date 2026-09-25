"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, body, date, friendly, unwrapItem, unwrapItems } from "./api";
import { Badge, Empty, Icon, Loading, Logo, Modal, Notice, useResource } from "./ui";
import PayrollApp from "./PayrollApp";

type Item = Record<string, any> & { id: string };
type OfflineOperation = {
  id: string;
  path: string;
  entityId?: string;
  expectedPriorState?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "conflict" | "failed";
  error?: { code?: string; status?: number; message: string; details?: unknown };
};
const queueKey = (userId: string, tenantId: string) => `modular-field-queue-v2:${tenantId}:${userId}`;

function readQueue(userId: string, tenantId: string): OfflineOperation[] {
  if (!userId || !tenantId || typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(queueKey(userId, tenantId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is OfflineOperation => Boolean(item && typeof item.id === "string" && typeof item.path === "string" && item.payload && typeof item.payload === "object")) : [];
  } catch { return []; }
}

function saveQueue(userId: string, tenantId: string, items: OfflineOperation[]) {
  if (!userId || !tenantId || typeof localStorage === "undefined") return false;
  try {
    const key = queueKey(userId, tenantId);
    if (items.length) localStorage.setItem(key, JSON.stringify(items));
    else localStorage.removeItem(key);
    return true;
  } catch { return false; }
}

function errorRecord(issue: unknown) {
  if (issue instanceof ApiError) return { code: issue.code, status: issue.status, message: issue.message, details: issue.details };
  return { message: issue instanceof Error ? issue.message : "Could not sync this update." };
}

function isTransient(issue: unknown) {
  return !(issue instanceof ApiError) || issue.status === 408 || issue.status === 425 || issue.status === 429 || issue.status >= 500;
}

function fieldErrorText(issue: OfflineOperation["error"]) {
  if (!issue) return "This update is waiting to sync.";
  if (issue.code === "CONFLICT" || issue.code === "IDEMPOTENCY_CONFLICT") {
    const details = issue.details && typeof issue.details === "object" ? issue.details as Record<string, unknown> : {};
    const expected = details.expectedState ?? details.expectedPriorState ?? "unknown";
    const current = details.currentState ?? details.current ?? "unknown";
    return `${issue.message} Expected job status: ${friendly(String(expected))}. Current job status: ${friendly(String(current))}.`;
  }
  return issue.message;
}

function evidenceSummary(payload: OfflineOperation["payload"]) {
  const text = [payload.text, payload.note, payload.description, payload.reason].find((value) => typeof value === "string" && value.trim());
  if (typeof text === "string") return text;
  if (typeof payload.photoName === "string") return `Photo attached: ${payload.photoName}`;
  if (payload.checklist && typeof payload.checklist === "object") return "Checklist responses saved.";
  if (typeof payload.photoDataUrl === "string") return "Photo evidence saved on this device.";
  return "Saved details are available to review.";
}

function operationLabel(operation: OfflineOperation) {
  if (operation.path.includes("/transition")) return "Job status update";
  if (operation.path.endsWith("/note")) return "Job note or photo";
  if (operation.path.endsWith("/complete")) return "Job completion";
  if (operation.path.endsWith("/skip")) return "Incomplete job report";
  if (operation.path === "/field/time") {
    const action = operation.payload.action;
    const labels: Record<string, string> = { clock_in: "Clock in", clock_out: "Clock out", break_start: "Start break", break_end: "End break" };
    return action === "mileage" ? "Mileage entry" : labels[String(action)] || "Time entry";
  }
  if (operation.path === "/field/tickets") return "Ticket for the office";
  return "Field update";
}

function clearFieldCaches(userId: string, tenantId: string) {
  try { sessionStorage.removeItem("modular-field-active-identity-v1"); } catch { /* Session storage is optional. */ }
  if (!("serviceWorker" in navigator)) return;
  const message = { type: "modular-crm-logout", userId, tenantId };
  const controller = navigator.serviceWorker.controller;
  if (controller) controller.postMessage(message);
  else void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage(message)).catch(() => {});
}

function navigationUrl(address: string) { return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`; }

function FieldRetry({ onRetry, label }: { onRetry: () => void; label: string }) {
  return <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry} aria-label={`Reload ${label}`}>Try again</button>;
}

export default function FieldApp({ section }: { section: string[] }) {
  const current = section[0] || "today";
  const identity = useResource<{ user?: { id?: string; name?: string; role?: string }; tenant?: { id?: string } }>("/auth/me", {});
  const userId = identity.data.user?.id || "";
  const tenantId = identity.data.tenant?.id || "";
  const [operations, setOperations] = useState<OfflineOperation[]>([]); const [syncError, setSyncError] = useState(""); const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(true);
  const pending = operations.length;
  useEffect(() => { setOperations(readQueue(userId, tenantId)); }, [userId, tenantId]);
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);
  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    if (!userId || !tenantId || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker.ready.then((registration) => {
      if (cancelled) return;
      let previousIdentity: { userId: string; tenantId: string } | undefined;
      try {
        const stored = JSON.parse(sessionStorage.getItem("modular-field-active-identity-v1") || "null");
        if (stored && typeof stored.userId === "string" && typeof stored.tenantId === "string") previousIdentity = stored;
        sessionStorage.setItem("modular-field-active-identity-v1", JSON.stringify({ userId, tenantId }));
      } catch { /* The worker still enforces per-identity cache names without session storage. */ }
      (navigator.serviceWorker.controller || registration.active)?.postMessage({ type: "modular-crm-identity", userId, tenantId, previousIdentity });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, tenantId]);
  async function syncPending(retryId?: string) {
    if (!userId || !tenantId) return;
    let queued = readQueue(userId, tenantId);
    if (retryId) {
      queued = queued.map((item) => item.id === retryId ? { ...item, status: "pending", error: undefined } : item);
      saveQueue(userId, tenantId, queued);
      setOperations(queued);
    }
    if (!queued.length) return;
    for (let index = 0; index < queued.length; index++) {
      const operation = queued[index]!;
      if (operation.status !== "pending") break;
      try {
        await api(operation.path, body({ ...operation.payload, clientOperationId: operation.id, deviceTimestamp: operation.createdAt }));
        queued = queued.filter((item) => item.id !== operation.id);
        saveQueue(userId, tenantId, queued);
        setOperations(queued);
      } catch (issue) {
        const error = errorRecord(issue);
        const conflict = error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT";
        const updated = { ...operation, status: conflict ? "conflict" as const : isTransient(issue) ? "pending" as const : "failed" as const, error };
        queued = queued.map((item) => item.id === operation.id ? updated : item);
        saveQueue(userId, tenantId, queued);
        setOperations(queued);
        setSyncError(error.message);
        return;
      }
    }
    if (!queued.length) { setSyncError(""); setNotice("Your field updates are synced."); }
  }
  useEffect(() => { if (!userId) return; const handler = () => void syncPending(); window.addEventListener("online", handler); if (navigator.onLine) void syncPending(); return () => window.removeEventListener("online", handler); }, [userId]);
  async function mutate(path: string, payload: unknown) {
    if (!userId || !tenantId) throw new Error("Sign in again before saving field updates.");
    const operationId = crypto.randomUUID();
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
    const operation: OfflineOperation = {
      id: operationId,
      path,
      entityId: path.split("/").includes("jobs") ? path.split("/")[path.split("/").indexOf("jobs") + 1] : undefined,
      expectedPriorState: typeof record.expectedPriorState === "string" ? record.expectedPriorState : undefined,
      payload: record,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    const priorQueue = readQueue(userId, tenantId);
    const queue = [...priorQueue, operation];
    if (!saveQueue(userId, tenantId, queue)) throw new Error("This device could not save the field update and its evidence. Free up device storage and try again.");
    setOperations(queue);
    if (priorQueue.length) {
      setNotice("Saved on this device behind earlier field updates. They will sync in order.");
      return "queued" as const;
    }
    try {
      await api(operation.path, body({ ...operation.payload, clientOperationId: operation.id, deviceTimestamp: operation.createdAt }));
      const remaining = readQueue(userId, tenantId).filter((item) => item.id !== operation.id);
      saveQueue(userId, tenantId, remaining);
      setOperations(remaining);
      setNotice("Update saved and synced.");
      return "saved" as const;
    } catch (issue) {
      const error = errorRecord(issue);
      const conflict = error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT";
      const failed = { ...operation, status: conflict ? "conflict" as const : isTransient(issue) ? "pending" as const : "failed" as const, error };
      const retained = readQueue(userId, tenantId).map((item) => item.id === operation.id ? failed : item);
      saveQueue(userId, tenantId, retained);
      setOperations(retained);
      setSyncError(error.message);
      setNotice(conflict ? "This update needs review. Your notes and evidence are saved on this device." : isTransient(issue) ? "Saved on this device. We’ll sync when you’re connected." : "This update could not be saved. Review it below and retry when ready.");
      return "queued" as const;
    }
  }
  async function logout() { if (pending && !window.confirm(`${pending} field update${pending === 1 ? " is" : "s are"} waiting to sync. They will stay saved on this device under your account and can sync after you sign back in. Sign out?`)) return; try { await api("/auth/logout", body({})); } finally { clearFieldCaches(userId, tenantId); window.location.href = "/login"; } }
  if (identity.loading) return <Loading label="Opening field work…"/>;
  if (identity.error) return <div className="auth-main" style={{ minHeight: "100vh" }}><div className="auth-box"><Logo/><h2 style={{ marginTop: 30 }}>Sign in for your route</h2><p>{identity.error}</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></div>;
  const role = identity.data.user?.role?.toLowerCase() || "";
  if (role && !role.includes("tech") && !role.includes("owner")) return <div className="auth-main" style={{ minHeight: "100vh" }}><div className="auth-box"><Logo/><h2 style={{ marginTop: 30 }}>Field access is limited</h2><p>Your account has a different workspace.</p><Link className="btn btn-primary" href={role.includes("customer") ? "/portal/home" : "/app/dashboard"}>Open my workspace</Link></div></div>;
  const nav = [{ key: "today", label: "Today", icon: "grid" }, { key: "route", label: "Route", icon: "route" }, { key: "time", label: "Time", icon: "clock" }, { key: "tickets", label: "Tickets", icon: "ticket" }, { key: "profile", label: "Profile", icon: "person" }] as const;
  const waitingCount = operations.filter((operation) => operation.status === "pending").length;
  const reviewCount = operations.filter((operation) => operation.status === "conflict").length;
  const failedCount = operations.filter((operation) => operation.status === "failed").length;
  return <div className="field-app"><header className="field-top"><Link href="/field/today"><Logo light/></Link><div className="inline-actions"><span style={{ fontSize: ".8rem", color: "#cde0d0" }}>{identity.data.user?.name || "Technician"}</span><Link href="/field/profile" className="avatar" aria-label="Profile">{(identity.data.user?.name || "T").slice(0, 1)}</Link></div></header><main className="field-content">{(!online || pending > 0) && <section className="field-sync" aria-label="Field update sync status" style={{ marginBottom: 14 }}><Notice kind={syncError || failedCount > 0 || reviewCount > 0 ? "error" : "info"} text={!online ? `${pending ? `${pending} update${pending === 1 ? "" : "s"} saved on this device. ` : "You’re offline. "}New field updates will stay on this device until you reconnect.${reviewCount ? ` ${reviewCount} ${reviewCount === 1 ? "update needs" : "updates need"} office review.` : ""}` : `${waitingCount ? `${waitingCount} update${waitingCount === 1 ? "" : "s"} waiting to sync.` : "No updates are waiting to sync."}${reviewCount ? ` ${reviewCount} ${reviewCount === 1 ? "update needs" : "updates need"} office review.` : ""}${failedCount ? ` ${failedCount} ${failedCount === 1 ? "update couldn’t" : "updates couldn’t"} sync; review the saved details below.` : ""}${syncError ? ` ${syncError}` : ""}`}/>{online && pending > 0 && operations.some((operation) => operation.status === "pending" || operation.status === "failed") && <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 7 }} onClick={() => void syncPending()}><Icon name="refresh" size={14}/> Sync updates</button>}{pending > 0 && <div className="stack" style={{ marginTop: 10 }}>{operations.map((operation) => <section className="card card-pad" key={operation.id} aria-label={`Queued update: ${operationLabel(operation)}`}><div className="card-heading"><h3 style={{ margin: 0 }}>{operationLabel(operation)}</h3><Badge status={operation.status === "conflict" ? "needs review" : operation.status === "failed" ? "failed" : "pending sync"}/></div><p className="subtle" style={{ marginBottom: 8 }}>{operation.status === "conflict" ? "The job changed while you were offline. Your note or evidence is safe on this device. Ask the office to review it before trying again." : fieldErrorText(operation.error)}</p><p className="subtle"><strong>Saved on this device:</strong> {evidenceSummary(operation.payload)}</p><small className="subtle">Recorded {date(operation.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{operation.expectedPriorState ? ` · Job was ${friendly(operation.expectedPriorState)}` : ""}</small>{Boolean(operation.payload.checklist && typeof operation.payload.checklist === "object") && <ul aria-label="Saved checklist responses">{Object.entries(operation.payload.checklist as Record<string, unknown>).map(([key, value]) => <li key={key}>{friendly(key)}: {value === true ? "Done" : "Not done"}</li>)}</ul>}{operation.status !== "conflict" && <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 9 }} onClick={() => void syncPending(operation.id)}>Retry update</button>}</section>)}</div>}</section>}{notice && <div style={{ marginBottom: 13 }}><Notice kind="success" text={notice} onClose={() => setNotice("")}/></div>}
    {current === "today" && <Today name={identity.data.user?.name || "Technician"} mutate={mutate}/>}
    {current === "route" && <Route/>}
    {current === "job" && section[1] && <Job id={section[1]} mutate={mutate}/>}
    {current === "time" && <Time mutate={mutate}/>}
    {current === "tickets" && <Tickets mutate={mutate}/>}
    {current === "pay" && <PayrollApp mode="statements"/>}
    {current === "profile" && <Profile name={identity.data.user?.name || "Technician"} logout={logout}/>}
    {!nav.some((item) => item.key === current) && current !== "job" && current !== "pay" && <Empty title="Page not found" description="Head back to today's work." action={<Link className="btn btn-primary" href="/field/today">Go to today</Link>}/>}</main><nav className="field-bottom-nav" aria-label="Field navigation">{nav.map((item) => <Link key={item.key} href={`/field/${item.key}`} className={current === item.key || current === "job" && item.key === "today" ? "active" : ""}><Icon name={item.icon} size={20}/>{item.label}</Link>)}</nav></div>;
}

function Today({ name, mutate }: { name: string; mutate: (path: string, payload: unknown) => Promise<"saved" | "queued"> }) {
  const result = useResource<Record<string, any>>("/field/today", {});
  const data = unwrapItem(result.data);
  const jobs: Item[] = data.jobs || data.route?.stops?.map((stop: Item) => ({ ...stop, id: stop.jobId || stop.id })) || [];
  const done = jobs.filter((job) => ["completed", "skipped"].includes(job.status)).length;
  const next = jobs.find((job) => !["completed", "skipped", "canceled"].includes(job.status));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function clock() { setBusy(true); setError(""); try { await mutate("/field/time", { action: data.shift?.status === "clocked_in" ? "clock_out" : "clock_in" }); result.reload(); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  return <><div className="field-greeting"><div><div className="eyebrow">{date(new Date().toISOString(), { weekday: "long", month: "long", day: "numeric" })}</div><h1>Today’s work</h1><p>{name.split(" ")[0]}{jobs.length ? ` · ${jobs.length} ${jobs.length === 1 ? "stop" : "stops"}, ${done} complete` : " · Your assigned work"}</p></div><button type="button" className="btn btn-secondary" disabled={busy || result.loading || Boolean(result.error)} onClick={clock} aria-label={data.shift?.status === "clocked_in" ? "Clock out of your shift" : "Clock in to your shift"}>{busy ? "Saving…" : data.shift?.status === "clocked_in" ? "Clock out" : "Clock in"}</button></div>{result.error && <><Notice kind="error" text={result.error}/><FieldRetry onRetry={result.reload} label="today’s work"/></>} {error && <Notice kind="error" text={error}/>} {result.loading ? <Loading label="Loading today’s work…"/> : <><section className="field-day-summary" aria-label="Route progress"><div><strong>{jobs.length ? `${jobs.length} ${jobs.length === 1 ? "stop" : "stops"}` : "No assigned stops"}</strong>{data.route?.distanceMiles > 0 && <span>{Number(data.route.distanceMiles).toFixed(1)} mi planned</span>}{data.route?.driveMinutes > 0 && <span>{data.route.driveMinutes} min drive</span>}</div><div className="route-progress"><span>{done} of {jobs.length} done</span><div className="progress-bar" role="progressbar" aria-label="Stops completed" aria-valuemin={0} aria-valuemax={jobs.length || 1} aria-valuenow={done}><span style={{ width: `${jobs.length ? done / jobs.length * 100 : 0}%` }}/></div></div><Link href="/field/route" className="link">View route order <Icon name="arrow" size={15}/></Link></section>{next && <><div className="section-title"><h2>Next stop</h2></div><JobCard job={next} number={jobs.indexOf(next) + 1} prominent/></>}{jobs.length ? <><div className="section-title"><h2>Stops</h2><span className="muted-label">{jobs.length} assigned</span></div>{jobs.map((job, index) => <JobCard job={job} number={index + 1} key={job.id}/>)}</> : !result.error && <Empty title="No route published yet" description="Your office will publish your route here when today’s work is ready."/>}</>}</>;
}

function JobCard({ job, number, prominent = false }: { job: Item; number: number; prominent?: boolean }) {
  return <div className="card field-job"><div className="field-job-top"><div><div className="job-number">Stop {number} · {job.serviceName || "Service"}</div><h3>{job.customerName || job.name || "Customer"}</h3><p>{job.address || "Address pending"}</p></div><Badge status={job.status}/></div>{(job.safetyFlag || job.safetyNotes) && <div className="field-warning"><Icon name="warning" size={16}/><span>{job.safetyNotes || "Review safety notes before starting."}</span></div>}<div className="inline-actions"><Link href={`/field/job/${job.jobId || job.id}`} className={`btn ${prominent ? "btn-primary" : "btn-secondary"} btn-sm`}>Open job <Icon name="arrow" size={15}/></Link>{job.address && <a href={navigationUrl(job.address)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm"><Icon name="map" size={15}/> Map</a>}</div></div>;
}

function Route() {
  const result = useResource<Record<string, any>>("/field/route", {});
  const data = unwrapItem(result.data);
  const jobs: Item[] = data.jobs || [];
  return <><div className="field-greeting"><div><div className="eyebrow">On the road</div><h1>Your route</h1><p>Stops are listed in the order your office set.</p></div></div>{result.error && <><Notice kind="error" text={result.error}/><FieldRetry onRetry={result.reload} label="your route"/></>} {result.loading ? <Loading label="Loading your route…"/> : jobs.length ? <><div className="card card-pad" style={{ marginTop: 16, marginBottom: 12 }}><div className="card-heading"><h2>{date(data.route?.date || new Date().toISOString())}</h2><Badge status={data.route?.status}/></div><div className="inline-actions" style={{ color: "var(--muted)", fontSize: ".82rem" }}><span>{jobs.length} stops</span><span>·</span><span>{Number(data.route?.distanceMiles || 0).toFixed(1)} mi</span><span>·</span><span>{data.route?.driveMinutes || 0} min drive</span></div></div><div className="route-list" aria-label="Stops in route order">{jobs.map((job, index) => <div className="route-line-item" key={job.id}><div className="route-line-track"><span aria-label={`Stop ${index + 1}`}>{index + 1}</span>{index < jobs.length - 1 && <i aria-hidden="true"/>}</div><div style={{ flex: 1 }}><JobCard job={job} number={index + 1}/></div></div>)}</div></> : !result.error && <Empty title="No published route" description="Your next published route will appear here once your office publishes it."/>}</>;
}

function Job({ id, mutate }: { id: string; mutate: (path: string, payload: unknown) => Promise<"saved" | "queued"> }) {
  const result = useResource<{ item: Item }>(`/field/jobs/${id}`, { item: { id } });
  const job = unwrapItem(result.data);
  const [note, setNote] = useState(""); const [reason, setReason] = useState(""); const [skipNote, setSkipNote] = useState(""); const [photo, setPhoto] = useState(""); const [photoName, setPhotoName] = useState(""); const [checklist, setChecklist] = useState<Record<string, boolean>>({}); const [skipOpen, setSkipOpen] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const checklistItems: Array<{ key: string; label: string; required: boolean }> = job.jobChecklist || [];
  const noncompletionReasons: Array<{ key: string; label: string }> = job.noncompletionReasons || [];
  const requiredChecklistComplete = checklistItems.filter((item) => item.required).every((item) => checklist[item.key] === true);
  const checklistSignature = JSON.stringify(checklistItems.map((item) => item.key));
  useEffect(() => { const keys = JSON.parse(checklistSignature) as string[]; setChecklist(Object.fromEntries(keys.map((key) => [key, false]))); }, [id, checklistSignature]);
  async function action(path: string, payload: unknown) { setBusy(true); setError(""); try { await mutate(path, { ...(payload as Record<string, unknown>), expectedPriorState: job.status }); result.reload(); if (path.endsWith("/note")) setNote(""); if (path.endsWith("/skip")) setSkipOpen(false); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  async function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; if (file.size > 1_500_000) { setError("Choose a photo under 1.5 MB so it can sync reliably."); return; } setPhotoName(file.name); const reader = new FileReader(); reader.onload = () => setPhoto(String(reader.result || "")); reader.readAsDataURL(file); }
  const terminal = ["completed", "skipped", "canceled"].includes(job.status);
  const requiredCount = checklistItems.filter((item) => item.required).length;
  const completedRequiredCount = checklistItems.filter((item) => item.required && checklist[item.key] === true).length;
  return <>
    <Link href="/field/today" className="link">← Today’s work</Link>
    {result.error && <div style={{ marginTop: 15 }}><Notice kind="error" text={result.error}/></div>}
    {error && <div style={{ marginTop: 15 }}><Notice kind="error" text={error} onClose={() => setError("")}/></div>}
    {result.loading ? <Loading label="Loading job details…"/> : result.error && !job.status ? <><Empty title="Job details couldn’t load" description="Check your connection and try again."/><FieldRetry onRetry={result.reload} label="job details"/></> : <>
      <header className="field-job-header" style={{ marginTop: 16 }}><div className="field-greeting"><div><div className="eyebrow">{job.serviceName || "Service"}{job.durationMinutes ? ` · about ${job.durationMinutes} min` : ""}</div><h1>{job.customerName || job.name || "Job"}</h1><Badge status={job.status}/></div></div>{job.address && <address>{job.address}</address>}<div className="inline-actions" style={{ marginTop: 10 }}>{job.address && <a className="btn btn-secondary" href={navigationUrl(job.address)} target="_blank" rel="noreferrer"><Icon name="map" size={16}/> Directions</a>}{job.phone && <a className="btn btn-secondary" href={`tel:${job.phone}`}><Icon name="person" size={16}/> Call customer</a>}</div></header>
      {!terminal && <section className="field-job-actions" aria-labelledby="job-actions-heading"><h2 id="job-actions-heading" className="sr-only">Job actions</h2><div className="inline-actions">{["scheduled", "dispatched"].includes(job.status) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => action(`/jobs/${id}/transition`, { status: "en_route" })}>{busy ? "Saving…" : "On my way"}</button>}{["scheduled", "dispatched", "en_route", "paused"].includes(job.status) && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => action(`/jobs/${id}/transition`, { status: "in_progress" })}>{busy ? "Saving…" : job.status === "paused" ? "Resume job" : "Start job"}</button>}{job.status === "in_progress" && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => action(`/jobs/${id}/transition`, { status: "paused" })}>Pause job</button>}{<button type="button" className="btn btn-danger" disabled={busy} onClick={() => setSkipOpen(true)}>Can’t complete</button>}</div></section>}
      <section className="field-job-section" aria-labelledby="site-context-heading"><div className="section-title"><h2 id="site-context-heading">Before you begin</h2></div><div className="detail-list"><dt>Expected time</dt><dd>{job.durationMinutes ? `${job.durationMinutes} minutes` : "See job instructions"}</dd></div>{job.access_notes && <div className="field-access-note"><strong>Access</strong><p>{job.access_notes}</p></div>}{(job.industryLocationFields || []).filter((field: Item) => field.value !== undefined && field.value !== null && field.value !== "").map((field: Item) => <div className="detail-list" key={field.key}><dt>{field.label}</dt><dd>{String(field.value)}</dd></div>)}{(job.industryAssets || []).map((asset: Item) => <div className="field-asset" key={asset.id}><strong>{asset.name}</strong><span className="subtle">{asset.assetLabel}</span>{(asset.fields || []).filter((field: Item) => field.key !== "name" && field.value !== null && field.value !== undefined && field.value !== "").map((field: Item) => <div className="detail-list" key={field.key}><dt>{field.label}</dt><dd>{String(field.value)}</dd></div>)}</div>)}{job.notes && <div className="field-instructions"><strong>Job instructions</strong><p>{job.notes}</p></div>}{!job.access_notes && !(job.industryLocationFields || []).some((field: Item) => field.value !== undefined && field.value !== null && field.value !== "") && !(job.industryAssets || []).length && !job.notes && <p className="subtle">No access details or service instructions were added.</p>}</section>
      {!terminal && <>
        <section className="field-job-section" aria-labelledby="checklist-heading"><div className="section-title"><h2 id="checklist-heading">Before you finish</h2>{requiredCount > 0 && <span className="muted-label">{completedRequiredCount} of {requiredCount} required</span>}</div>{checklistItems.length ? <fieldset className="field-checklist" disabled={busy || job.status !== "in_progress"}><legend className="sr-only">Job completion checklist</legend>{checklistItems.map((item) => <label className="checkbox-row" key={item.key}><input type="checkbox" checked={checklist[item.key] === true} aria-required={item.required || undefined} onChange={(event) => setChecklist((current) => ({ ...current, [item.key]: event.target.checked }))}/><span>{item.label}{item.required ? <span aria-label="required"> <span aria-hidden="true">*</span></span> : <span className="subtle"> (optional)</span>}</span></label>)}</fieldset> : <p className="subtle">There are no extra completion steps for this job.</p>}{job.status !== "in_progress" && <p className="subtle">Start the job before marking it complete.</p>}<button type="button" className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={busy || !requiredChecklistComplete || job.status !== "in_progress"} onClick={() => action(`/field/jobs/${id}/complete`, { checklist, note, photoDataUrl: photo || undefined, photoName: photoName || undefined })}>{busy ? "Saving completion…" : "Complete job"} {!busy && <Icon name="check" size={17}/>}</button>{job.status === "in_progress" && !requiredChecklistComplete && <small className="subtle" style={{ display: "block", marginTop: 8 }}>Finish the required steps to complete this job.</small>}</section>
        <section className="field-job-section" aria-labelledby="job-note-heading"><div className="section-title"><h2 id="job-note-heading">Note or photo</h2></div><div className="field"><label htmlFor="field-note">Share an update with the office</label><textarea id="field-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a service note or issue"/></div><div className="field" style={{ marginTop: 12 }}><label htmlFor="field-photo">Add a photo (optional)</label><input id="field-photo" type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={choosePhoto}/>{photoName && <small role="status">{photoName} is ready to save with your next update.</small>}</div><button type="button" className="btn btn-secondary" style={{ marginTop: 12 }} disabled={busy || !note.trim() && !photo} onClick={() => action(`/field/jobs/${id}/note`, { text: note, photoDataUrl: photo || undefined, photoName: photoName || undefined })}>{busy ? "Saving…" : "Save note"}</button></section>
      </>}
      {terminal && <Notice kind="info" text={job.status === "completed" ? "This job is complete." : job.status === "skipped" ? "This job was recorded as incomplete." : "This job was canceled by the office."}/>}
    </>}
    {skipOpen && <Modal title="Why can’t this job be completed?" onClose={() => setSkipOpen(false)}><div className="field"><label htmlFor="skip-reason">Reason</label><select id="skip-reason" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Choose a reason</option>{noncompletionReasons.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div><div className="field" style={{ marginTop: 14 }}><label htmlFor="skip-note">More details (optional)</label><textarea id="skip-note" value={skipNote} onChange={(event) => setSkipNote(event.target.value)}/></div>{error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setSkipOpen(false)}>Back</button><button type="button" className="btn btn-danger" disabled={!reason || busy} onClick={() => action(`/field/jobs/${id}/skip`, { reason, note: skipNote })}>{busy ? "Recording…" : "Record skip"}</button></div></Modal>}
  </>;
}

function Time({ mutate }: { mutate: (path: string, payload: unknown) => Promise<"saved" | "queued"> }) {
  const result = useResource<Record<string, any>>("/field/time", {});
  const data = unwrapItem(result.data);
  const [miles, setMiles] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function action(kind: string, extra: Record<string, unknown> = {}) { setBusy(true); setError(""); try { await mutate("/field/time", { action: kind, ...extra }); result.reload(); if (kind === "mileage") setMiles(""); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  const clocked = data.shift?.status === "clocked_in"; const onBreak = data.shift?.status === "on_break";
  return <><div className="eyebrow">Your workday</div><h1>Time & mileage</h1>{result.error && <><Notice kind="error" text={result.error}/><FieldRetry onRetry={result.reload} label="time and mileage"/></>} {error && <Notice kind="error" text={error}/>} {result.loading ? <Loading label="Loading shift details…"/> : <div className="stack"><div className="card card-pad"><div className="card-heading"><h2>Shift</h2><Badge status={data.shift?.status || "clocked_out"}/></div><p className="subtle" style={{ fontSize: ".85rem" }}>{data.shift?.startedAt ? `Started ${date(data.shift.startedAt, { hour: "numeric", minute: "2-digit" })}` : "You haven’t clocked in today."}</p><div className="inline-actions">{!clocked && !onBreak ? <button type="button" className="btn btn-primary" disabled={busy || Boolean(result.error)} onClick={() => action("clock_in")}>{busy ? "Saving…" : "Clock in"}</button> : <><button type="button" className="btn btn-secondary" disabled={busy || Boolean(result.error)} onClick={() => action(onBreak ? "break_end" : "break_start")}>{busy ? "Saving…" : onBreak ? "End break" : "Start break"}</button><button type="button" className="btn btn-primary" disabled={busy || Boolean(result.error)} onClick={() => action("clock_out")}>{busy ? "Saving…" : "Clock out"}</button></>}</div></div><div className="card card-pad"><h2>Record mileage</h2><div className="field"><label htmlFor="mileage">Miles driven</label><input id="mileage" type="number" min="0.1" step="0.1" inputMode="decimal" value={miles} onChange={(event) => setMiles(event.target.value)}/></div><button type="button" className="btn btn-secondary" style={{ marginTop: 12 }} disabled={busy || Boolean(result.error) || !miles || Number(miles) <= 0} onClick={() => action("mileage", { miles: Number(miles) })}>{busy ? "Saving…" : "Save mileage"}</button></div>{(data.entries || []).length > 0 && <div className="card card-pad"><h2>Recent activity</h2>{data.entries.map((entry: Item) => <div className="action-item" key={entry.id}><div><strong>{friendly(entry.action || entry.type)}</strong><p>{date(entry.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div>{entry.miles && <strong style={{ marginLeft: "auto" }}>{entry.miles} mi</strong>}</div>)}</div>}</div>}</>;
}

function Tickets({ mutate }: { mutate: (path: string, payload: unknown) => Promise<"saved" | "queued"> }) {
  const result = useResource<{ items: Item[] }>("/field/tickets", { items: [] });
  const [open, setOpen] = useState(false); const [subject, setSubject] = useState(""); const [description, setDescription] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await mutate("/field/tickets", { subject, description, type: "field_issue" }); setOpen(false); setSubject(""); setDescription(""); result.reload(); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  return <><div className="field-greeting"><div><div className="eyebrow">Follow-ups</div><h1>Tickets</h1></div><button type="button" className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={15}/> New ticket</button></div>{result.error && <><Notice kind="error" text={result.error}/><FieldRetry onRetry={result.reload} label="tickets"/></>} {result.loading ? <Loading label="Loading tickets…"/> : <div className="stack" style={{ marginTop: 18 }}>{unwrapItems(result.data).length ? unwrapItems(result.data).map((ticket) => <div className="card card-pad" key={ticket.id}><div className="card-heading"><h3>{ticket.subject}</h3><Badge status={ticket.status}/></div><p className="subtle" style={{ fontSize: ".84rem" }}>{ticket.description || ""}</p></div>) : !result.error && <Empty title="No tickets yet" description="Open a ticket to send an issue or follow-up to the office."/>}</div>}{open && <Modal title="Send an issue to the office" onClose={() => setOpen(false)}><form onSubmit={submit}><div className="stack"><div className="field"><label htmlFor="ticket-subject">What needs attention?</label><input id="ticket-subject" required value={subject} onChange={(event) => setSubject(event.target.value)}/></div><div className="field"><label htmlFor="ticket-description">Details</label><textarea id="ticket-description" required value={description} onChange={(event) => setDescription(event.target.value)}/></div></div>{error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send to office"}</button></div></form></Modal>}</>;
}

function Profile({ name, logout }: { name: string; logout: () => void }) {
  const result = useResource<{ item: Item }>("/field/profile", { item: { id: "" } });
  const profile = unwrapItem(result.data);
  return <><div className="eyebrow">Your account</div><h1>Profile</h1><section className="card card-pad" style={{ marginTop: 18 }}><div className="inline-actions"><div className="avatar" style={{ width: 48, height: 48, fontSize: "1.05rem" }}>{name.slice(0, 1)}</div><div><h2 style={{ margin: 0 }}>{name}</h2><p className="subtle" style={{ margin: 0, fontSize: ".82rem" }}>Field technician</p></div></div>{result.error && <div style={{ marginTop: 18 }}><Notice kind="error" text={result.error}/><FieldRetry onRetry={result.reload} label="profile"/></div>}{result.loading ? <Loading label="Loading your profile…"/> : !result.error && <><div className="divider"/><div className="detail-list"><dt>Email</dt><dd>{profile.email || "—"}</dd></div><div className="detail-list"><dt>Phone</dt><dd>{profile.phone || "—"}</dd></div><div className="detail-list"><dt>Location</dt><dd>{profile.locationName || "—"}</dd></div></>}<div className="inline-actions" style={{ marginTop: 18 }}><Link href="/field/pay" className="btn btn-secondary">My pay statements</Link><button type="button" className="btn btn-secondary" onClick={logout}>Sign out</button></div></section></>;
}

