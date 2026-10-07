"use client";
import ServiceDetails from "./ServiceDetails";
import { PackDetails } from "./PackFields";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, body, date, friendly, unwrapItem, unwrapItems } from "./api";
import { Badge, Empty, Icon, Loading, Logo, Modal, Notice, useResource } from "./ui";
import PayrollApp from "./PayrollApp";

type Item = Record<string, any> & { id: string };
import { blockedBy, dependencyKey, discardGroup, drainQueue, fieldActions, fieldErrorText, projectedJobState, projectedShiftState, queueKey, readQueue, resumeAuthenticatedQueue, saveQueue, withQueueLock, type OfflineOperation } from "./field-queue";

function evidenceSummary(payload: OfflineOperation["payload"]) {
  const text = [payload.text, payload.note, payload.description, payload.reason].find((value) => typeof value === "string" && value.trim());
  if (typeof text === "string") return text;
  if (typeof payload.photoName === "string") return `Photo attached: ${payload.photoName}`;
  if (payload.checklist && typeof payload.checklist === "object") return "Checklist responses saved.";
  if (typeof payload.photoDataUrl === "string") return "Photo evidence saved on this device.";
  return "Saved details are available to review.";
}

function clearFieldCaches(userId: string, tenantId: string) {
  try { sessionStorage.removeItem("modular-field-active-identity-v1"); } catch { /* Session storage is optional. */ }
  if (!("serviceWorker" in navigator)) return;
  const message = { type: "modular-crm-logout", userId, tenantId };
  const controller = navigator.serviceWorker.controller;
  if (controller) controller.postMessage(message);
  else void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage(message)).catch(() => {});
}

function useFieldRefresh(reload: () => void) {
  useEffect(() => {
    window.addEventListener("modular-field-refreshed", reload);
    return () => window.removeEventListener("modular-field-refreshed", reload);
  }, [reload]);
}

function navigationUrl(address: string) { return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`; }

export default function FieldApp({ section }: { section: string[] }) {
  const current = section[0] || "today";
  const identity = useResource<{ user?: { id?: string; name?: string; role?: string; permissions?: string[] }; tenant?: { id?: string } }>("/auth/me", {});
  const userId = identity.data.user?.id || "";
  const tenantId = identity.data.tenant?.id || "";
  const [operations, setOperations] = useState<OfflineOperation[]>([]); const [syncError, setSyncError] = useState(""); const [notice, setNotice] = useState("");
  const pending = operations.length;
  useEffect(() => { setOperations(readQueue(userId, tenantId)); }, [userId, tenantId]);
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);
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
  const persist = useCallback((items: OfflineOperation[]) => {
    if (!saveQueue(userId, tenantId, items)) throw new Error("This device could not save the field update and its evidence. Free up device storage and try again.");
    setOperations(items);
  }, [userId, tenantId]);
  const syncQueue = useCallback(async (retryId?: string) => {
    const before = readQueue(userId, tenantId);
    if (!before.length) return;
    if (retryId) persist(readQueue(userId, tenantId).map((item) => item.id === retryId ? { ...item, status: "pending", error: undefined } : item));
    await drainQueue({ read: () => readQueue(userId, tenantId), write: persist }, (operation) =>
      api(operation.path, body({ ...operation.payload, clientOperationId: operation.id, deviceTimestamp: operation.createdAt })));
    const remaining = readQueue(userId, tenantId);
    setOperations(remaining);
    if (before.some((item) => !remaining.some((retained) => retained.id === item.id))) window.dispatchEvent(new Event("modular-field-refreshed"));
    setSyncError(remaining.find((item) => item.error) ? fieldErrorText(remaining.find((item) => item.error)!.error) : "");
    if (!remaining.length) setNotice("Your field updates are synced.");
  }, [userId, tenantId, persist]);
  const syncPending = useCallback(async (retryId?: string) => {
    if (!userId || !tenantId) return;
    try { await withQueueLock(queueKey(userId, tenantId), () => syncQueue(retryId)); }
    catch (issue) { setSyncError((issue as Error).message); }
  }, [userId, tenantId, syncQueue]);
  useEffect(() => {
    if (!userId || !tenantId) return;
    const handler = () => void syncPending();
    const refresh = () => setOperations(readQueue(userId, tenantId));
    window.addEventListener("online", handler);
    window.addEventListener("storage", refresh);
    // Returning after sign-in confirms this queue's identity. Genuine conflicts
    // and permission failures remain reviewable, never automatically retried.
    if (navigator.onLine) void withQueueLock(queueKey(userId, tenantId), async () => {
      const saved = readQueue(userId, tenantId);
      if (saved.some((item) => item.status === "failed" && item.error?.status === 401)) persist(resumeAuthenticatedQueue(saved));
      await syncQueue();
    }).catch((issue) => setSyncError((issue as Error).message));
    return () => { window.removeEventListener("online", handler); window.removeEventListener("storage", refresh); };
  }, [userId, tenantId, syncPending, persist, syncQueue]);
  async function mutate(path: string, payload: unknown) {
    if (!userId || !tenantId) throw new Error("Sign in again before saving field updates.");
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
    const operation: OfflineOperation = {
      id: crypto.randomUUID(), path,
      entityId: path.split("/").includes("jobs") ? path.split("/")[path.split("/").indexOf("jobs") + 1] : undefined,
      expectedPriorState: typeof record.expectedPriorState === "string" ? record.expectedPriorState : undefined,
      payload: record, createdAt: new Date().toISOString(), status: "pending",
    };
    return withQueueLock(queueKey(userId, tenantId), async () => {
      persist([...readQueue(userId, tenantId), operation]);
      if (navigator.onLine) await syncQueue();
      const retained = readQueue(userId, tenantId).find((item) => item.id === operation.id);
      setNotice(retained ? "Saved on this device. Related updates sync in order; other work can continue." : "Update saved and synced.");
      return retained ? "queued" as const : "saved" as const;
    });
  }
  async function discard(id: string) {
    try {
      await withQueueLock(queueKey(userId, tenantId), async () => {
        const queue = readQueue(userId, tenantId);
        const group = discardGroup(queue, id);
        if (!group.length || !window.confirm(`Discard ${group.length} saved update${group.length === 1 ? "" : "s"} for this work item, including later dependent updates and their evidence? Download the saved details first if needed. This cannot undo any update already received by the office.`)) return;
        persist(queue.filter((item) => !group.some((removed) => removed.id === item.id)));
        window.dispatchEvent(new Event("modular-field-refreshed"));
        setNotice("Saved updates discarded for this work item. Reopen it to check the current office status before continuing.");
        await syncQueue();
      });
    } catch (issue) { setSyncError((issue as Error).message); }
  }
  function downloadEvidence(id: string) {
    const group = discardGroup(readQueue(userId, tenantId), id);
    const url = URL.createObjectURL(new Blob([JSON.stringify(group, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `field-updates-${id}.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function logout() { if (pending && !window.confirm(`${pending} field update${pending === 1 ? " is" : "s are"} waiting to sync. They will stay saved on this device under your account and can sync after you sign back in. Sign out?`)) return; try { await api("/auth/logout", body({})); } finally { clearFieldCaches(userId, tenantId); window.location.href = "/login"; } }
  if (identity.loading) return <Loading label="Opening field work…"/>;
  if (identity.error) return <div className="auth-main" style={{ minHeight: "100vh" }}><div className="auth-box"><Logo/><h2 style={{ marginTop: 30 }}>Sign in for your route</h2><p>{identity.error}</p><Link className="btn btn-primary" href="/login">Sign in</Link></div></div>;
  const role = identity.data.user?.role?.toLowerCase() || "";
  if (role && !role.includes("tech") && !role.includes("owner")) return <div className="auth-main" style={{ minHeight: "100vh" }}><div className="auth-box"><Logo/><h2 style={{ marginTop: 30 }}>Field access is limited</h2><p>Your account has a different workspace.</p><Link className="btn btn-primary" href={role.includes("customer") ? "/portal/home" : "/app/dashboard"}>Open my workspace</Link></div></div>;
  const nav = [{ key: "today", label: "Today", icon: "grid" }, { key: "route", label: "Route", icon: "route" }, { key: "time", label: "Time", icon: "clock" }, { key: "tickets", label: "Tickets", icon: "ticket" }, { key: "profile", label: "Profile", icon: "person" }] as const;
  return <div className="field-app"><header className="field-top"><Link href="/field/today"><Logo light/></Link><div className="inline-actions"><span style={{ fontSize: ".8rem", color: "#cde0d0" }}>{identity.data.user?.name || "Technician"}</span><Link href="/field/profile" className="avatar" aria-label="Profile">{(identity.data.user?.name || "T").slice(0, 1)}</Link></div></header><main className="field-content">{pending > 0 && <div style={{ marginBottom: 14 }}><Notice kind={syncError ? "error" : "info"} text={`${pending} update${pending === 1 ? "" : "s"} waiting to sync.${syncError ? ` ${syncError}` : ""}`}/><button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 7 }} onClick={() => void syncPending()}><Icon name="refresh" size={14}/> Try syncing now</button><div className="stack" style={{ marginTop: 10 }}>{operations.map((operation) => <section className="card card-pad" key={operation.id} aria-label={`Queued update ${operation.id}`}><div className="card-heading"><h3 style={{ margin: 0 }}>{operation.path.includes("transition") ? `Job update · ${operation.entityId || "job"}` : operation.path.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ") || "Field update"}</h3><Badge status={operation.status === "conflict" ? "needs review" : operation.status === "failed" ? "failed" : "pending sync"}/></div><p className="subtle" style={{ marginBottom: 8 }}>{blockedBy(operations, operation) ? "Waiting for an earlier update for this work item." : fieldErrorText(operation.error)}</p><p className="subtle"><strong>Saved evidence:</strong> {evidenceSummary(operation.payload)}</p><small className="subtle">Recorded {date(operation.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{operation.expectedPriorState ? ` · Expected state: ${friendly(operation.expectedPriorState)}` : ""}</small><details style={{ marginTop: 9 }}><summary>Review saved details and evidence</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: ".75rem", maxHeight: 220, overflow: "auto" }}>{JSON.stringify(operation.payload, null, 2)}</pre></details><button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 9 }} disabled={Boolean(blockedBy(operations, operation))} onClick={() => void syncPending(operation.id)}>{operation.status === "conflict" ? "Retry after review" : "Retry update"}</button>{operation.entityId && <Link className="btn btn-secondary btn-sm" style={{ marginTop: 9, marginLeft: 8 }} href={`/field/job/${operation.entityId}`} onClick={() => window.dispatchEvent(new Event("modular-field-refreshed"))}>Review current job</Link>}<button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 9, marginLeft: 8 }} onClick={() => downloadEvidence(operation.id)}>Download saved details</button><button type="button" className="btn btn-danger btn-sm" style={{ marginTop: 9, marginLeft: 8 }} onClick={() => void discard(operation.id)}>Discard saved update</button></section>)}</div></div>}{notice && <div style={{ marginBottom: 13 }}><Notice kind="success" text={notice} onClose={() => setNotice("")}/></div>}
    {current === "today" && <Today name={identity.data.user?.name || "Technician"} mutate={mutate} operations={operations}/>}
    {current === "route" && <Route/>}
    {current === "job" && section[1] && <Job key={section[1]} id={section[1]} mutate={mutate} operations={operations} permissions={identity.data.user?.permissions || []}/>}
    {current === "time" && <Time mutate={mutate} operations={operations}/>}
    {current === "tickets" && <Tickets mutate={mutate}/>}
    {current === "pay" && <PayrollApp mode="statements"/>}
    {current === "profile" && <Profile name={identity.data.user?.name || "Technician"} logout={logout}/>}
    {!nav.some((item) => item.key === current) && current !== "job" && current !== "pay" && <Empty title="Page not found" description="Head back to today's work." action={<Link className="btn btn-primary" href="/field/today">Go to today</Link>}/>}</main><nav className="field-bottom-nav" aria-label="Field navigation">{nav.map((item) => <Link key={item.key} href={`/field/${item.key}`} className={current === item.key || current === "job" && item.key === "today" ? "active" : ""}><Icon name={item.icon} size={20}/>{item.label}</Link>)}</nav></div>;
}

function Today({ name, mutate, operations }: { operations: OfflineOperation[]; name: string; mutate: (path: string, payload: unknown) => Promise<"saved" | "queued"> }) {
  const result = useResource<Record<string, any>>("/field/today", {});
  const data = unwrapItem(result.data);
  const jobs: Item[] = data.jobs || data.route?.stops?.map((stop: Item) => ({ ...stop, id: stop.jobId || stop.id })) || [];
  const shiftStatus = projectedShiftState(data.shift?.status || "clocked_out", operations);
  const shiftNeedsReview = operations.some((item) => dependencyKey(item) === "shift" && item.status !== "pending");
  const done = jobs.filter((job) => ["completed", "skipped"].includes(job.status)).length;
  const next = jobs.find((job) => !["completed", "skipped", "canceled"].includes(job.status));
  useFieldRefresh(result.reload);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function clock() { setBusy(true); setError(""); try { await mutate("/field/time", { action: ["clocked_in", "on_break"].includes(shiftStatus) ? "clock_out" : "clock_in" }); result.reload(); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  return <><div className="field-greeting"><div><div className="eyebrow">Field workspace</div><h1>Good morning, {name.split(" ")[0]}.</h1><p>{date(new Date().toISOString(), { weekday: "long", month: "long", day: "numeric" })}</p></div><button type="button" className="btn btn-secondary btn-sm" disabled={busy || shiftNeedsReview} onClick={clock}>{["clocked_in", "on_break"].includes(shiftStatus) ? "Clock out" : "Clock in"}</button></div>{result.error && <Notice kind="error" text={result.error}/>} {error && <Notice kind="error" text={error}/>} {result.loading ? <Loading/> : <><div className="field-hero"><div className="eyebrow">Today’s route</div><h2>{jobs.length ? `${jobs.length} stops on your route` : "Your day is clear"}</h2><p>{data.route?.distanceMiles ? `${Number(data.route.distanceMiles).toFixed(1)} miles planned · ` : ""}{data.route?.driveMinutes ? `${data.route.driveMinutes} minutes of drive time` : "Open your route to see the full plan."}</p><div className="route-progress"><span>{done} of {jobs.length} done</span><div className="progress-bar"><span style={{ width: `${jobs.length ? done / jobs.length * 100 : 0}%` }}/></div></div><Link href="/field/route" className="btn btn-lime" style={{ marginTop: 22 }}>Open route <Icon name="arrow" size={16}/></Link></div>{next && <><div className="section-title"><h2>Next stop</h2><Link href="/field/route" className="link">Full route</Link></div><JobCard job={next} number={jobs.indexOf(next) + 1} prominent/></>}<div className="section-title"><h2>All stops</h2><span className="muted-label">{jobs.length} total</span></div>{jobs.length ? jobs.map((job, index) => <JobCard job={job} number={index + 1} key={job.id}/>) : <div className="card"><Empty title="No route published yet" description="Your office will publish your route here when today’s work is ready."/></div>}</>}</>;
}

function JobCard({ job, number, prominent = false }: { job: Item; number: number; prominent?: boolean }) {
  return <div className="card field-job"><div className="field-job-top"><div><div className="job-number">Stop {number} · {job.serviceName || "Service"}</div><h3>{job.customerName || job.name || "Customer"}</h3><p>{job.address || "Address pending"}</p></div><Badge status={job.status}/></div>{(job.safetyFlag || job.safetyNotes) && <div className="field-warning"><Icon name="warning" size={16}/><span>{job.safetyNotes || "Review safety notes before starting."}</span></div>}<div className="inline-actions"><Link href={`/field/job/${job.jobId || job.id}`} className={`btn ${prominent ? "btn-primary" : "btn-secondary"} btn-sm`}>Open job <Icon name="arrow" size={15}/></Link>{job.address && <a href={navigationUrl(job.address)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm"><Icon name="map" size={15}/> Map</a>}</div></div>;
}

function Route() {
  const result = useResource<Record<string, any>>("/field/route", {});
  const data = unwrapItem(result.data);
  const jobs: Item[] = data.jobs || [];
  useFieldRefresh(result.reload);
  return <><div className="field-greeting"><div><div className="eyebrow">On the road</div><h1>Your route</h1><p>Follow stops in order and keep your office up to date.</p></div></div>{result.error && <Notice kind="error" text={result.error}/>} {result.loading ? <Loading/> : jobs.length ? <><div className="card card-pad" style={{ marginTop: 19, marginBottom: 16 }}><div className="card-heading"><h2>{date(data.route?.date || new Date().toISOString())}</h2><Badge status={data.route?.status}/></div><div className="inline-actions" style={{ color: "var(--muted)", fontSize: ".82rem" }}><span>{jobs.length} stops</span><span>·</span><span>{Number(data.route?.distanceMiles || 0).toFixed(1)} miles</span><span>·</span><span>{data.route?.driveMinutes || 0} min drive</span></div></div><div className="route-list">{jobs.map((job, index) => <div className="route-line-item" key={job.id}><div className="route-line-track"><span>{index + 1}</span>{index < jobs.length - 1 && <i/>}</div><div style={{ flex: 1 }}><JobCard job={job} number={index + 1}/></div></div>)}</div></> : <div className="card" style={{ marginTop: 20 }}><Empty title="No published route" description="Your next published route will appear here once your office publishes it."/></div>}</>;
}

function Job({ id, mutate, operations, permissions }: { id: string; mutate: (path: string, payload: unknown) => Promise<"saved" | "queued">; operations: OfflineOperation[]; permissions: string[] }) {
  const result = useResource<{ item: Item }>(`/field/jobs/${id}`, { item: { id } });
  const serverJob = unwrapItem(result.data);
  const job: Item = { ...serverJob, status: projectedJobState(serverJob.status, id, operations) };
  const needsReview = operations.some((item) => dependencyKey(item) === `job:${id}` && item.status !== "pending");
  const actions = needsReview ? [] : fieldActions(job.status, permissions);
  useFieldRefresh(result.reload);
  const [note, setNote] = useState(""); const [reason, setReason] = useState(""); const [photo, setPhoto] = useState(""); const [photoName, setPhotoName] = useState(""); const [checks, setChecks] = useState<Record<string, boolean>>({}); const [skipOpen, setSkipOpen] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function action(path: string, payload: unknown) { setBusy(true); setError(""); try { await mutate(path, { ...(payload as Record<string, unknown>), expectedPriorState: job.status }); result.reload(); if (path.endsWith("/note")) setNote(""); if (path.endsWith("/skip")) setSkipOpen(false); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  async function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; if (file.size > 1_500_000) { setError("Choose a photo under 1.5 MB so it can sync reliably."); return; } setPhotoName(file.name); const reader = new FileReader(); reader.onload = () => setPhoto(String(reader.result || "")); reader.readAsDataURL(file); }
  return <><Link href="/field/today" className="link">← Today’s work</Link>{result.error && <div style={{ marginTop: 15 }}><Notice kind="error" text={result.error}/></div>} {error && <div style={{ marginTop: 15 }}><Notice kind="error" text={error} onClose={() => setError("")}/></div>}{result.loading ? <Loading/> : <><div className="field-greeting" style={{ marginTop: 22 }}><div><div className="eyebrow">{job.serviceName || "Service"}</div><h1>{job.customerName || job.name || "Job"}</h1><p>{job.address || "Address pending"}</p></div><Badge status={job.status}/></div>{operations.some((item) => dependencyKey(item) === `job:${id}`) && <Notice kind="info" text="Status includes updates saved on this device. The office sees them after they sync."/>}<div className="inline-actions" style={{ margin: "14px 0 21px" }}>{job.address && <a className="btn btn-secondary btn-sm" href={navigationUrl(job.address)} target="_blank" rel="noreferrer"><Icon name="map" size={15}/> Open map</a>}{job.phone && <a className="btn btn-secondary btn-sm" href={`tel:${job.phone}`}><Icon name="person" size={15}/> Call customer</a>}</div><div className="stack"><div className="card card-pad"><h2>Before you begin</h2><div className="detail-list"><dt>Service</dt><dd>{job.serviceName || "Service"}</dd></div><div className="detail-list"><dt>Expected time</dt><dd>{job.durationMinutes ? `${job.durationMinutes} minutes` : "See job instructions"}</dd></div><div className="detail-list"><dt>Access</dt><dd>{job.accessNotes || "No special access notes"}</dd></div><ServiceDetails items={job.assets}/><PackDetails fields={job.fields ?? []} values={job.fieldValues ?? {}}/>{job.safetyNotes && <div className="field-warning"><Icon name="warning" size={18}/><span>{job.safetyNotes}</span></div>}{job.notes && <p style={{ margin: "16px 0 0", fontSize: ".84rem" }}>{job.notes}</p>}</div><div className="card card-pad"><h2>Job actions</h2><p className="subtle" style={{ fontSize: ".85rem" }}>Update the customer and office as you work.</p><div className="inline-actions">{actions.includes("en_route") && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => action(`/jobs/${id}/transition`, { status: "en_route" })}>On my way</button>}{actions.includes("in_progress") && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => action(`/jobs/${id}/transition`, { status: "in_progress" })}>{job.status === "paused" ? "Resume job" : "Start job"}</button>}{actions.includes("paused") && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => action(`/jobs/${id}/transition`, { status: "paused" })}>Pause job</button>}{actions.includes("skipped") && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setSkipOpen(true)}>Can’t complete</button>}</div>{!actions.length && <p className="subtle">{needsReview ? "Review the saved update above before making more changes to this job." : "No field actions are available for this job’s current status. Contact your office if work is still needed."}</p>}</div>{!["completed", "skipped", "canceled", "needs_return", "missed"].includes(job.status) && <><div className="card card-pad"><h2>Notes & proof</h2><div className="field"><label htmlFor="field-note">What should the office know?</label><textarea id="field-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a service note or mention an issue"/></div><div className="field" style={{ marginTop: 14 }}><label htmlFor="field-photo">Completion photo (optional)</label><input id="field-photo" type="file" accept="image/*" capture="environment" onChange={choosePhoto}/>{photoName && <small>Ready to upload: {photoName}</small>}</div><button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 16 }} disabled={busy || needsReview || !permissions.includes("jobs.forms_submit") || !note.trim() && !photo} onClick={() => action(`/field/jobs/${id}/note`, { text: note, photoDataUrl: photo || undefined, photoName: photoName || undefined })}>Save note</button></div>{actions.includes("completed") && <div className="card card-pad"><h2>Finish this job</h2><p className="subtle" style={{ fontSize: ".85rem" }}>Confirm these steps before marking service complete.</p>{(job.checklist || []).map((item: Item) => <label className="checkbox-row" key={item.key} style={{ marginTop: 12 }}><input type="checkbox" checked={Boolean(checks[item.key])} onChange={event => setChecks({ ...checks, [item.key]: event.target.checked })}/>{item.label}</label>)}<button type="button" className="btn btn-primary btn-block" style={{ marginTop: 20 }} disabled={busy || (job.checklist || []).some((item: Item) => item.required && !checks[item.key]) || job.status !== "in_progress"} onClick={() => action(`/field/jobs/${id}/complete`, { checklist: checks, note, photoDataUrl: photo || undefined, photoName: photoName || undefined })}>Complete job <Icon name="check" size={17}/></button>{job.status !== "in_progress" && <small className="subtle" style={{ display: "block", marginTop: 9 }}>Start the job before completing it.</small>}</div>}</>}</div></>}{skipOpen && <Modal title="Why can’t this job be completed?" onClose={() => setSkipOpen(false)}><div className="field"><label htmlFor="skip-reason">Reason</label><select id="skip-reason" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Choose a reason</option>{(job.skipReasons || []).map((option: Item) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div><div className="field" style={{ marginTop: 14 }}><label htmlFor="skip-note">More details (optional)</label><textarea id="skip-note" value={note} onChange={(event) => setNote(event.target.value)}/></div>{error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setSkipOpen(false)}>Back</button><button type="button" className="btn btn-danger" disabled={!reason || busy} onClick={() => action(`/field/jobs/${id}/skip`, { reason, note })}>Record skip</button></div></Modal>}</>;
}

function Time({ mutate, operations }: { operations: OfflineOperation[]; mutate: (path: string, payload: unknown) => Promise<"saved" | "queued"> }) {
  const result = useResource<Record<string, any>>("/field/time", {});
  const data = unwrapItem(result.data);
  useFieldRefresh(result.reload);
  const [miles, setMiles] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function action(kind: string, extra: Record<string, unknown> = {}) { setBusy(true); setError(""); try { await mutate("/field/time", { action: kind, ...extra }); result.reload(); if (kind === "mileage") setMiles(""); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  const shiftStatus = projectedShiftState(data.shift?.status || "clocked_out", operations);
  const shiftNeedsReview = operations.some((item) => dependencyKey(item) === "shift" && item.status !== "pending");
  const clocked = shiftStatus === "clocked_in"; const onBreak = shiftStatus === "on_break";
  return <><div className="eyebrow">Your workday</div><h1>Time & mileage</h1><p className="subtle">Track your shift and travel as the day happens.</p>{result.error && <Notice kind="error" text={result.error}/>} {error && <Notice kind="error" text={error}/>} {result.loading ? <Loading/> : <div className="stack"><div className="card card-pad"><div className="card-heading"><h2>Shift</h2><Badge status={shiftStatus}/></div><p className="subtle" style={{ fontSize: ".85rem" }}>{data.shift?.startedAt ? `Started ${date(data.shift.startedAt, { hour: "numeric", minute: "2-digit" })}` : "You haven’t clocked in today."}</p><div className="inline-actions">{!clocked && !onBreak ? <button type="button" className="btn btn-primary" disabled={busy || shiftNeedsReview} onClick={() => action("clock_in")}>Clock in</button> : <><button type="button" className="btn btn-secondary" disabled={busy || shiftNeedsReview} onClick={() => action(onBreak ? "break_end" : "break_start")}>{onBreak ? "End break" : "Start break"}</button><button type="button" className="btn btn-primary" disabled={busy || shiftNeedsReview} onClick={() => action("clock_out")}>Clock out</button></>}</div></div><div className="card card-pad"><h2>Record mileage</h2><p className="subtle" style={{ fontSize: ".85rem" }}>Enter miles driven for work today.</p><div className="field"><label htmlFor="mileage">Miles</label><input id="mileage" type="number" min="0.1" step="0.1" value={miles} onChange={(event) => setMiles(event.target.value)}/></div><button type="button" className="btn btn-secondary" style={{ marginTop: 15 }} disabled={busy || !miles || Number(miles) <= 0} onClick={() => action("mileage", { miles: Number(miles) })}>Save mileage</button></div>{(data.entries || []).length > 0 && <div className="card card-pad"><h2>Recent activity</h2>{data.entries.map((entry: Item) => <div className="action-item" key={entry.id}><div><strong>{friendly(entry.action || entry.type)}</strong><p>{date(entry.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div>{entry.miles && <strong style={{ marginLeft: "auto" }}>{entry.miles} mi</strong>}</div>)}</div>}</div>}</>;
}

function Tickets({ mutate }: { mutate: (path: string, payload: unknown) => Promise<"saved" | "queued"> }) {
  const result = useResource<{ items: Item[] }>("/field/tickets", { items: [] });
  const [open, setOpen] = useState(false); const [subject, setSubject] = useState(""); const [description, setDescription] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await mutate("/field/tickets", { subject, description, type: "field_issue" }); setOpen(false); setSubject(""); setDescription(""); result.reload(); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); } }
  return <><div className="field-greeting"><div><div className="eyebrow">Follow-ups</div><h1>Tickets</h1><p>Keep the office informed about issues that need attention.</p></div><button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><Icon name="plus" size={15}/> New ticket</button></div>{result.error && <Notice kind="error" text={result.error}/>} {result.loading ? <Loading/> : <div className="stack" style={{ marginTop: 18 }}>{unwrapItems(result.data).length ? unwrapItems(result.data).map((ticket) => <div className="card card-pad" key={ticket.id}><div className="card-heading"><h3>{ticket.subject}</h3><Badge status={ticket.status}/></div><p className="subtle" style={{ fontSize: ".84rem" }}>{ticket.description || ""}</p></div>) : <div className="card"><Empty title="No tickets assigned" description="You can open a ticket whenever a customer or property issue needs follow-up."/></div>}</div>}{open && <Modal title="Create a ticket" onClose={() => setOpen(false)}><form onSubmit={submit}><div className="stack"><div className="field"><label htmlFor="ticket-subject">What needs attention?</label><input id="ticket-subject" required value={subject} onChange={(event) => setSubject(event.target.value)}/></div><div className="field"><label htmlFor="ticket-description">Details</label><textarea id="ticket-description" required value={description} onChange={(event) => setDescription(event.target.value)}/></div></div>{error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>Send to office</button></div></form></Modal>}</>;
}

function Profile({ name, logout }: { name: string; logout: () => void }) {
  const result = useResource<{ item: Item }>("/field/profile", { item: { id: "" } });
  const profile = unwrapItem(result.data);
  return <><div className="eyebrow">Your account</div><h1>Profile</h1><div className="card card-pad" style={{ marginTop: 18 }}><div className="inline-actions"><div className="avatar" style={{ width: 52, height: 52, fontSize: "1.2rem" }}>{name.slice(0, 1)}</div><div><h2 style={{ margin: 0 }}>{name}</h2><p className="subtle" style={{ margin: 0, fontSize: ".82rem" }}>Field technician</p></div></div>{result.error && <div style={{ marginTop: 18 }}><Notice kind="error" text={result.error}/></div>}{!result.loading && <><div className="divider"/><div className="detail-list"><dt>Email</dt><dd>{profile.email || "—"}</dd></div><div className="detail-list"><dt>Phone</dt><dd>{profile.phone || "—"}</dd></div><div className="detail-list"><dt>Location</dt><dd>{profile.locationName || "—"}</dd></div></>}<Link href="/field/pay" className="btn btn-secondary" style={{ marginTop: 23, marginRight: 8 }}>My pay statements</Link><button type="button" className="btn btn-secondary" style={{ marginTop: 23 }} onClick={logout}>Sign out</button></div></>;
}

