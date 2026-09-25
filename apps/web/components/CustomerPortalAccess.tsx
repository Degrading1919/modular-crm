"use client";

import { useState } from "react";
import { api, body, unwrapItems } from "./api";
import { Badge, Loading, Notice, useResource } from "./ui";

type Location = { id: string; name?: string; addressLine1?: string; city?: string; region?: string };
type Access = { id: string; email: string; status: string; invitedAt?: string; activatedAt?: string; serviceLocationIds: string[] };

export default function CustomerPortalAccess({ customerId, email, locations }: { customerId: string; email?: string; locations: Location[] }) {
  const result = useResource<{ items: Access[] }>(`/customers/${customerId}/portal-access`, { items: [] });
  const [inviteEmail, setInviteEmail] = useState(email || "");
  const [selected, setSelected] = useState<string[]>(locations.map((location) => location.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function invite(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await api(`/customers/${customerId}/portal-access`, body({ email: inviteEmail, serviceLocationIds: selected }));
      setNotice("Portal invitation sent. The customer will activate access by email."); result.reload();
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  async function revoke(access: Access) {
    if (!window.confirm(`Revoke portal access for ${access.email}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await api(`/customers/${customerId}/portal-access/${access.id}`, { method: "DELETE" }); setNotice("Portal access revoked. Customer records and history are preserved."); result.reload(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card card-pad" aria-label="Customer portal access">
    <div className="card-heading"><div><h3 style={{ margin: 0 }}>Customer portal</h3><p className="subtle" style={{ fontSize: ".84rem", margin: "4px 0 0" }}>Choose exactly which service addresses this sign-in can see.</p></div></div>
    {(error || result.error) && <Notice kind="error" text={error || result.error!}/>} {notice && <Notice kind="success" text={notice}/>}
    {result.loading ? <Loading label="Loading portal access…"/> : unwrapItems(result.data).length ? <div className="stack" style={{ marginBottom: 18 }}>{unwrapItems(result.data).map((access) => <div className="action-item" key={access.id}>
      <div><strong>{access.email}</strong><p className="subtle" style={{ margin: "4px 0", fontSize: ".82rem" }}>{access.serviceLocationIds.map((id) => locations.find((location) => location.id === id)?.name || locations.find((location) => location.id === id)?.addressLine1 || "Service address").join(", ") || "No address grants"}</p><Badge status={access.status}/></div>
      {access.status !== "revoked" && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => revoke(access)}>Revoke</button>}
    </div>)}</div> : <p className="subtle" style={{ fontSize: ".84rem", marginBottom: 16 }}>No customer portal access has been granted.</p>}
    <form onSubmit={invite} className="stack" style={{ gap: 12 }}><div className="field"><label htmlFor={`portal-email-${customerId}`}>Customer email</label><input id={`portal-email-${customerId}`} type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)}/></div>
      {locations.length ? <fieldset className="stack" style={{ border: 0, padding: 0, gap: 8 }}><legend className="muted-label" style={{ marginBottom: 6 }}>Allowed service addresses</legend>{locations.map((location) => <label className="checkbox-row" key={location.id}><input type="checkbox" checked={selected.includes(location.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, location.id] : selected.filter((id) => id !== location.id))}/>{location.name || location.addressLine1 || "Service address"}{location.city ? ` · ${location.city}` : ""}</label>)}</fieldset> : <p className="subtle" style={{ fontSize: ".84rem" }}>Add a service address before inviting a portal user.</p>}
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !locations.length || !selected.length}>{busy ? "Sending invitation…" : "Invite to customer portal"}</button>
    </form>
  </section>;
}
