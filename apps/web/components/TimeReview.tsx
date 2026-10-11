"use client";

import { useState } from "react";
import { api, body, date } from "./api";
import { Badge, Empty, Loading, Modal, Notice, useResource } from "./ui";

type Entry = { id: string; staffName: string; startsAt: string; endsAt: string; updatedAt: string; approvalStatus: string; note?: string };
type Shift = { id: string; staffName: string; clockInAt: string; updatedAt: string };

export default function TimeReview({ permissions }: { permissions: readonly string[] }) {
  const result = useResource<{ entries: Entry[]; shifts: Shift[] }>("/time", { entries: [], shifts: [] });
  const [shift, setShift] = useState<Shift | null>(null), [end, setEnd] = useState(""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function save(path: string, payload: Record<string, unknown>, message: string) {
    setBusy(true); setError("");
    try { await api(path, body(payload)); setShift(null); setNotice(message); result.reload(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  return <><div className="page-head"><div><div className="eyebrow">Staff</div><h1>Review work time</h1><p>Close forgotten shifts and approve hours before calculating pay. Times below use your device’s time zone.</p></div></div>
    {(result.error || error) && <Notice kind="error" text={result.error || error}/>}{notice && <Notice kind="success" text={notice}/>}
    {result.loading ? <Loading/> : <div className="stack">
      <section className="card card-pad"><h2>Still clocked in</h2>{!result.data.shifts.length && <p>No open shifts.</p>}{result.data.shifts.map(item => <div className="action-item" key={item.id}><div><strong>{item.staffName}</strong><p>Started {date(item.clockInAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div>{permissions.includes("time.correct") && <button className="btn btn-secondary" disabled={busy} onClick={() => { setShift(item); setEnd(""); setReason(""); setError(""); }}>Fix clock-out</button>}</div>)}</section>
      <section className="card card-pad"><h2>Recorded hours</h2><p className="subtle">Latest 200 entries. Pending hours are not paid until approved.</p>{!result.data.entries.length && <Empty title="No recorded hours" description="Clocked-out shifts appear here for review."/>}{result.data.entries.map(item => <article className="action-item" aria-label={`Time for ${item.staffName}`} key={item.id}><div><strong>{item.staffName}</strong><p>{date(item.startsAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} – {date(item.endsAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p><p>{((new Date(item.endsAt).getTime()-new Date(item.startsAt).getTime())/3_600_000).toFixed(2)} elapsed hours · Pay excludes unpaid breaks{item.note ? ` · ${item.note}` : ""}</p><Badge status={item.approvalStatus}/></div>{item.approvalStatus !== "approved" && permissions.includes("time.approve") && <button className="btn btn-primary" disabled={busy} onClick={() => void save(`/time/entries/${item.id}/approve`, { expectedUpdatedAt: item.updatedAt }, "Hours approved. Recalculate any open pay period to include them.")}>Approve hours</button>}</article>)}</section>
    </div>}
    {shift && <Modal title="Fix forgotten clock-out" onClose={() => !busy && setShift(null)}><form onSubmit={event => { event.preventDefault(); void save(`/time/shifts/${shift.id}/clock-out`, { endsAt: new Date(end).toISOString(), reason, expectedUpdatedAt: shift.updatedAt }, "Clock-out recorded. Review and approve these hours separately."); }}><p>{shift.staffName} clocked in {date(shift.clockInAt)}. This correction is recorded in the history; hours remain pending approval.</p><label className="field">Clock-out time<input type="datetime-local" required value={end} onChange={event => setEnd(event.target.value)}/></label><label className="field">Reason<textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)}/></label>{error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setShift(null)}>Back</button><button className="btn btn-primary" disabled={busy}>Record clock-out</button></div></form></Modal>}
  </>;
}
