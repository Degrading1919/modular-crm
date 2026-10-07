"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WorkspaceLink as Link, useWorkspaceAccess } from "./WorkspaceAccess";
import { canUseAction } from "../lib/workspace-access";
import { businessDate, formatCalendarDate } from "../lib/dates";
import { addDays } from "../lib/schedule-dates";
import { api, body } from "./api";
import { Badge, Loading, Modal, Notice, useResource } from "./ui";

type Visit = { id: string; customerName: string; serviceName: string; status: string; scheduledDate: string | null; updatedAt: string; organizationLocationId: string; branchName: string; timezone: string; technicianId: string | null; technicianName: string | null; startTime: string | null; endTime: string | null; assignedRouteId: string | null };
type Technician = { id: string; name: string; locationIds: string[] };
type ScheduleData = { from: string; through: string; timeZone: string; weekStartsOn: number; branches: { id: string; name: string }[]; technicians: Technician[]; items: Visit[]; unscheduled: Visit[] };
const initial: ScheduleData = { from: "", through: "", timeZone: "UTC", weekStartsOn: 1, branches: [], technicians: [], items: [], unscheduled: [] };
const editable = new Set(["draft", "unscheduled", "scheduled", "dispatched", "missed"]);
const labelDay = (value: string) => formatCalendarDate(value, { weekday: "short", month: "short", day: "numeric" });

export default function Schedule({ timeZone }: { timeZone: string }) {
  const access = useWorkspaceAccess(), router = useRouter(), params = useSearchParams();
  const requested = params.get("week"), location = params.get("locationId") ?? "";
  const result = useResource<ScheduleData>(`/schedule?${new URLSearchParams({ ...(requested ? { week: requested } : {}), ...(location ? { locationId: location } : {}) })}`, initial);
  const data = result.data;
  const day = params.get("day") ?? requested ?? businessDate(new Date(), data.from ? data.timeZone : timeZone);
  useEffect(() => {
    if (data.from && !requested) {
      const query = new URLSearchParams(params.toString()); query.set("week", data.from); query.set("day", day);
      router.replace(`/app/schedule?${query}`);
    }
  }, [data.from, requested, params, router, day]);
  const [phone, setPhone] = useState(false);
  useEffect(() => { const media = window.matchMedia("(max-width:760px)"); const update = () => setPhone(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const view = phone || params.get("view") === "day" ? "day" : "week";
  const mayMove = canUseAction(access, "schedule", ["jobs.assign", "staff.read"]);
  const [selected, setSelected] = useState<Visit | null>(null), [moveDate, setMoveDate] = useState(""), [technician, setTechnician] = useState("");
  const [start, setStart] = useState(""), [end, setEnd] = useState("");
  const [notice, setNotice] = useState(""), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const [assignMode, setAssignMode] = useState(false);
  function navigate(nextDay: string, nextView = view, branch = location) {
    const query = new URLSearchParams({ week: nextDay, day: nextDay, view: nextView });
    if (branch) query.set("locationId", branch);
    router.push(`/app/schedule?${query}`);
  }
  function open(visit: Visit, assign = false) { setAssignMode(assign); setSelected(visit); setMoveDate(visit.scheduledDate ?? day); setTechnician(visit.technicianId ?? ""); setStart(visit.startTime ?? ""); setEnd(visit.endTime ?? ""); setError(""); }
  async function move(visit: Visit, nextDay: string, nextTechnician: string, arrivalWindow?: { start: string; end: string } | null) {
    if (saving) return;
    if (!editable.has(visit.status)) { setError("Only work that has not started can be rescheduled or reassigned."); return; }
    setSaving(true); setError("");
    try {
      const dateChanged = nextDay !== visit.scheduledDate;
      const assignmentChanged = nextTechnician !== (visit.technicianId ?? "");
      const action = dateChanged || arrivalWindow !== undefined ? "reschedule" : "reassign";
      if (!dateChanged && !assignmentChanged && arrivalWindow === undefined) return;
      await api(`/jobs/${visit.id}/${action}`, body({ idempotencyKey: crypto.randomUUID(), expectedUpdatedAt: visit.updatedAt,
        ...(action === "reschedule" ? { scheduledDate: nextDay } : {}), ...(assignmentChanged ? { technicianId: nextTechnician || null } : {}),
        ...(arrivalWindow !== undefined ? { arrivalWindow } : {}) }));
      setSelected(null); setNotice(visit.assignedRouteId || visit.status === "dispatched" ? "Visit moved. Publish the route again to send the new schedule to the technician." : assignMode ? "Job assigned. The route planner can now include it." : "Visit moved. Plan and publish its route to send it to the technician."); setAssignMode(false); result.reload();
    } catch (cause) { setError((cause as Error).message); result.reload(); }
    finally { setSaving(false); }
  }
  function drop(event: React.DragEvent, nextDay: string, lane: string) {
    event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); const visit = [...data.items, ...data.unscheduled].find(item => item.id === id);
    if (visit) void move(visit, nextDay, lane);
  }
  function card(visit: Visit) {
    return <article key={visit.id} className="schedule-visit" data-visit-id={visit.id} draggable={mayMove && !saving} onDragStart={event => { event.dataTransfer.setData("text/plain", visit.id); event.dataTransfer.effectAllowed = "move"; }}>
      <Link href={`/app/jobs/${visit.id}`} draggable={false} className="table-primary">{visit.customerName}</Link><p>{visit.serviceName}</p>
      <p>{visit.startTime && visit.endTime ? `${visit.startTime}–${visit.endTime}` : "Any time"}{location ? "" : ` · ${visit.branchName}`}</p><Badge status={visit.status}/>
      {mayMove && <button type="button" className="btn btn-secondary btn-sm" disabled={saving} aria-label={`Move ${visit.customerName}`} onClick={() => open(visit)}>Move…</button>}
      {mayMove && !visit.technicianId && editable.has(visit.status) && <button type="button" className="btn btn-secondary btn-sm" disabled={saving} aria-label={`Assign ${visit.serviceName} for ${visit.customerName}`} onClick={() => open(visit, true)}>Assign</button>}
    </article>;
  }
  const lanes = [{ id: "", name: "Unassigned", locationIds: data.branches.map(branch => branch.id) }, ...data.technicians];
  // Inactive assignments remain visible and truthful; only active technicians are drop targets.
  for (const visit of data.items) if (visit.technicianId && !lanes.some(lane => lane.id === visit.technicianId)) lanes.push({ id: visit.technicianId, name: `${visit.technicianName ?? "Former technician"} (unavailable)`, locationIds: [] });
  const days = data.from ? Array.from({ length: 7 }, (_, index) => addDays(data.from, index)) : [];
  function cell(lane: Technician, value: string, visits: Visit[]) {
    return <div key={`${lane.id}:${value}`} className="schedule-cell" aria-label={`${lane.name}, ${labelDay(value)}`} data-schedule-day={value} data-technician-id={lane.id} onDragOver={event => { if (mayMove && lane.locationIds.length) event.preventDefault(); }} onDrop={event => { if (mayMove && lane.locationIds.length) drop(event, value, lane.id); }}>{visits.map(card)}</div>;
  }
  return <>
    <div className="page-head"><div><div className="eyebrow">Operations</div><h1>Schedule</h1><p className="subtle">Plan the week, set arrival windows, and keep your technicians in sync.</p></div><div className="inline-actions"><Link className="btn btn-secondary" href="/app/routes">Plan routes</Link><Link className="btn btn-primary" href="/app/jobs?new=1">New job</Link></div></div>
    {result.error && <Notice kind="error" text={result.error}/>} {error && <Notice kind="error" text={error}/>} {notice && <Notice kind="success" text={notice} onClose={() => setNotice("")}/>}
    <div className="schedule-toolbar"><div className="inline-actions"><button className="btn btn-secondary" onClick={() => navigate(addDays(view === "week" ? data.from || day : day, view === "week" ? -7 : -1))}>Previous</button><button className="btn btn-secondary" onClick={() => navigate(businessDate(new Date(), data.from ? data.timeZone : timeZone))}>Today</button><button className="btn btn-secondary" onClick={() => navigate(addDays(view === "week" ? data.from || day : day, view === "week" ? 7 : 1))}>Next</button></div>
      <div className="field"><label htmlFor="schedule-date">Schedule date</label><input id="schedule-date" type="date" value={day} onChange={event => { if (event.target.value) navigate(event.target.value); }}/></div>
      <div className="field"><label htmlFor="schedule-branch">Branch</label><select id="schedule-branch" value={location} onChange={event => navigate(day, view, event.target.value)}><option value="">All accessible branches</option>{data.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>
      <div className="inline-actions schedule-view-buttons"><button className={`btn ${view === "week" ? "btn-primary" : "btn-secondary"}`} aria-pressed={view === "week"} onClick={() => navigate(day, "week")}>Week</button><button className={`btn ${view === "day" ? "btn-primary" : "btn-secondary"}`} aria-pressed={view === "day"} onClick={() => navigate(day, "day")}>Day</button></div>
    </div>
    {result.loading ? <Loading/> : !result.error && <>
      <p className="subtle">{data.from && `${labelDay(data.from)} – ${labelDay(data.through)}`} · {data.timeZone}. Arrival windows use each visit’s branch time zone.</p>
      <div className="schedule-layout"><section className={`card schedule-desktop schedule-${view}`} aria-label={`${view === "week" ? "Week" : "Day"} calendar`}>
        {view === "week" ? <div className="schedule-week-grid"><div className="schedule-heading">Technician</div>{days.map(value => <button className="schedule-heading" key={value} onClick={() => navigate(value, "day")}>{labelDay(value)}</button>)}{lanes.map(lane => <div className="schedule-week-row" key={lane.id}><div className="schedule-heading">{lane.name}</div>{days.map(value => cell(lane, value, data.items.filter(visit => visit.scheduledDate === value && (visit.technicianId ?? "") === lane.id)))}</div>)}</div>
        : <div className="schedule-day-grid" style={{ gridTemplateColumns: `80px repeat(${lanes.length}, minmax(190px,1fr))` }}><div className="schedule-heading">Time</div>{lanes.map(lane => <div className="schedule-heading" key={lane.id}>{lane.name}</div>)}{["Any time", ...Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`)].map(hour => <div className="schedule-week-row" key={hour}><div className="schedule-heading">{hour}</div>{lanes.map(lane => cell(lane, day, data.items.filter(visit => visit.scheduledDate === day && (visit.technicianId ?? "") === lane.id && (visit.startTime ? `${visit.startTime.slice(0, 2)}:00` : "Any time") === hour)))}</div>)}</div>}
      </section>
      <section className="schedule-phone" aria-label="Phone day calendar"><h2>{labelDay(day)}</h2>{lanes.map(lane => <section className="card card-pad" key={lane.id}><h3>{lane.name}</h3>{data.items.filter(visit => visit.scheduledDate === day && (visit.technicianId ?? "") === lane.id).map(card)}</section>)}</section>
      <aside className="card card-pad schedule-tray" aria-label="Unscheduled visits"><h2>Unscheduled</h2><p className="subtle">Drag a visit onto a day, or choose Move…</p>{data.unscheduled.length ? data.unscheduled.map(card) : <p>No unscheduled visits.</p>}</aside></div>
    </>}
    {selected && <Modal title={`Move ${selected.customerName}`} onClose={() => setSelected(null)}><form onSubmit={event => { event.preventDefault(); if ((start && !end) || (!start && end)) { setError("Enter both arrival times, or leave both blank for Any time."); return; } void move(selected, moveDate, technician, start && end ? { start, end } : null); }}>
      <p className="subtle">Arrival window · {selected.timezone}. Changing published work requires publishing its route again.</p>
      <div className="form-grid"><div className="field"><label htmlFor="move-day">Service day</label><input id="move-day" required type="date" value={moveDate} onChange={event => setMoveDate(event.target.value)}/></div><div className="field"><label htmlFor="move-technician">Technician</label><select id="move-technician" value={technician} onChange={event => setTechnician(event.target.value)}><option value="">Unassigned</option>{data.technicians.filter(person => person.locationIds.includes(selected.organizationLocationId)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div><div className="field"><label htmlFor="arrival-start">Arrival window start</label><input id="arrival-start" type="time" value={start} onChange={event => setStart(event.target.value)}/></div><div className="field"><label htmlFor="arrival-end">Arrival window end</label><input id="arrival-end" type="time" value={end} onChange={event => setEnd(event.target.value)}/></div></div>
      {error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>Cancel</button><button className="btn btn-primary" disabled={saving || assignMode && !technician}>{saving ? "Moving…" : assignMode ? "Assign job" : "Save changes"}</button></div>
    </form></Modal>}
  </>;
}
