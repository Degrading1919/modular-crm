"use client";

import { useState } from "react";
import { api, body } from "./api";
import { Notice, useResource } from "./ui";

export default function PlanWorkerAssignment({ plan, onDone }: { plan: { id: string; updatedAt: string; organizationLocationId?: string; preferredAssignment?: { membershipId?: string } }; onDone: () => void }) {
  const staff = useResource<{ items: { id: string; name: string; role: string; status: string; fieldWorker: boolean; locationIds: string[] }[] }>("/staff?fieldWorkers=true", { items: [] });
  const [selected, setSelected] = useState(plan.preferredAssignment?.membershipId || "");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  return <section className="card card-pad" aria-label="Usual field worker"><h3>Usual field worker</h3><p className="subtle">New recurring visits go to this person. Existing visits keep their assignments; use the schedule to move them.</p>
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { await api(`/service-plans/${plan.id}/assignment`, body({ technicianId: selected || null, expectedUpdatedAt: plan.updatedAt })); setNotice("Usual worker saved for new visits."); onDone(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the worker."); } finally { setBusy(false); } }}>
      <label className="field">Usual field worker<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Leave new visits unassigned</option>{staff.data.items.filter(person => person.status === "active" && person.fieldWorker && (person.role === "owner" || person.locationIds.includes(plan.organizationLocationId || ""))).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <button className="btn btn-secondary" disabled={busy || staff.loading} style={{ marginTop: 12 }}>Save usual worker</button>
    </form>{(error || staff.error) && <Notice kind="error" text={error || staff.error}/ >}{notice && <Notice kind="success" text={notice}/ >}
  </section>;
}
