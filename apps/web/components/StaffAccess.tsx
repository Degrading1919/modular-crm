"use client";
import { useState } from "react";
import { api, body, patch, unwrapItems } from "./api";
import { Badge, Loading, Modal, Notice, useResource } from "./ui";

type Member = { id: string; name: string; email: string; role: string; status: string; locationIds: string[]; locationName?: string };
export default function StaffAccess({ permissions }: { permissions: string[] }) {
  const result = useResource<{ items: Member[] }>("/staff", { items: [] });
  const locations = useResource<{ items: { id: string; name: string }[] }>("/organization", { items: [] });
  const [editing, setEditing] = useState<Member | null>(null), [inviting, setInviting] = useState(false);
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [role, setRole] = useState("technician"), [locationIds, setLocationIds] = useState<string[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const mayEdit = permissions.includes("staff.update"), mayRole = permissions.includes("roles.manage"), mayStatus = permissions.includes("staff.deactivate");
  function edit(member: Member) { setEditing(member); setRole(member.role); setLocationIds(member.locationIds); setError(""); }
  async function changeStatus(member: Member) {
    if (!window.confirm(member.status === "inactive" ? `Restore ${member.name}'s access?` : `Deactivate ${member.name}? Their history will be kept.`)) return;
    setBusy(true); setError("");
    try { await api(`/staff/${member.id}`, patch({ status: member.status === "inactive" ? "active" : "inactive" })); setNotice("Team access updated. History has been kept."); result.reload(); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (editing) await api(`/staff/${editing.id}`, patch({ ...(mayRole ? { role } : {}), locationIds }));
      else {
        const created = await api<{ invite?: { temporaryPassword?: string; invitationUrl?: string } }>("/staff", body({ name, email, role, locationId: locationIds[0] }));
        setNotice(created.invite?.temporaryPassword ? `Local development account created. Temporary password: ${created.invite.temporaryPassword}` : created.invite?.invitationUrl ? `Local invitation link: ${created.invite.invitationUrl}` : "Invitation sent. Check the email to finish account setup.");
      }
      if (editing) setNotice("Team access updated.");
      setEditing(null); setInviting(false); result.reload();
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><div className="eyebrow">Your business</div><h1>Staff</h1><p>Choose who can help, what they can do, and where they can work. Deactivation keeps their history.</p></div>{permissions.includes("staff.invite") && <button className="btn btn-primary" onClick={() => { setInviting(true); setEditing(null); setName(""); setEmail(""); setRole("technician"); setLocationIds(locations.data.items[0] ? [locations.data.items[0].id] : []); setError(""); }}>Invite team member</button>}</div>
    {notice && <Notice kind="success" text={notice}/>} {(error || result.error || locations.error) && <Notice kind="error" text={error || result.error || locations.error}/>}
    {result.loading ? <Loading/> : <div className="stack">{unwrapItems(result.data).map(member => <section className="card card-pad" key={member.id} aria-label={member.name}><div className="card-heading"><div><h2>{member.name}</h2><p>{member.email}</p></div><Badge status={member.status}/></div><p>{member.role === "office" ? "Office / Manager" : member.role === "owner" ? "Owner / Admin" : "Field Technician"} · {member.locationName || "No location assigned"}</p><div className="inline-actions">{mayEdit && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => edit(member)}>Edit access</button>}{mayEdit && mayStatus && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => changeStatus(member)}>{member.status === "inactive" ? "Reactivate" : "Deactivate"}</button>}</div></section>)}</div>}
    {(editing || inviting) && <Modal title={editing ? `Edit access for ${editing.name}` : "Invite team member"} onClose={() => { setEditing(null); setInviting(false); }}><form onSubmit={submit} className="stack">{!editing && <><div className="field"><label htmlFor="staff-name">Name</label><input id="staff-name" required value={name} onChange={e => setName(e.target.value)}/></div><div className="field"><label htmlFor="staff-email">Email</label><input id="staff-email" type="email" required value={email} onChange={e => setEmail(e.target.value)}/></div></>}
      <div className="field"><label htmlFor="staff-role">Role</label><select id="staff-role" value={role} disabled={editing ? !mayRole : false} onChange={e => setRole(e.target.value)}>{editing && <option value="owner">Owner / Admin</option>}{(editing || mayRole) && <option value="office">Office / Manager</option>}<option value="technician">Field Technician</option></select></div>
      <fieldset><legend>{editing ? "Allowed locations" : "Starting location"}</legend>{locations.data.items.map(location => <label className="checkbox-row" key={location.id}><input type={editing ? "checkbox" : "radio"} name="staff-location" checked={locationIds.includes(location.id)} onChange={e => setLocationIds(editing ? e.target.checked ? [...locationIds, location.id] : locationIds.filter(id => id !== location.id) : [location.id])}/>{location.name}</label>)}</fieldset>
      {error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => { setEditing(null); setInviting(false); }}>Cancel</button><button className="btn btn-primary" disabled={busy || !locationIds.length}>{busy ? "Saving…" : editing ? "Save access" : "Send invitation"}</button></div></form></Modal>}
  </>;
}
