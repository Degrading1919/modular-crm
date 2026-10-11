"use client";
import { useState } from "react";
import { api, body, date } from "./api";
import { Notice, useResource } from "./ui";
export default function TicketThread({ id, portal = false, canReply = false, canClose = false, onDone }: { id: string; portal?: boolean; canReply?: boolean; canClose?: boolean; onDone?: () => void }) {
  const result = useResource<{ items: Record<string, any>[] }>(`${portal ? "/portal" : ""}/tickets/${id}/thread`, { items: [] });
  const [reply, setReply] = useState(""), [visibility, setVisibility] = useState("customer"), [key, setKey] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function save(close = false) {
    setBusy(true); setError("");
    try { await api(`/tickets/${id}/thread`, body({ ...(reply.trim() ? { body: reply, commentId: key, visibility } : {}), close })); setReply(""); setKey(crypto.randomUUID()); setNotice("Saved. Customer-visible replies can be read in the portal; no email notification was sent."); result.reload(); onDone?.(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <section className="card card-pad" aria-label="Ticket conversation"><h2>Conversation</h2>{result.data.items.map(item => <article key={item.id}><strong>{item.actorType === "staff" ? "Service team" : "Customer"}{item.visibility === "internal" ? " · Office only" : ""}</strong><p style={{ whiteSpace: "pre-wrap" }}>{item.body}</p><small>{date(item.createdAt)}</small></article>)}{!result.loading && !result.data.items.length && <p>No replies yet.</p>}{(result.error || error) && <Notice kind="error" text={result.error || error}/ >}{notice && <Notice kind="success" text={notice}/ >}
    {!portal && (canReply || canClose) && <form onSubmit={event => { event.preventDefault(); void save(); }}>{canReply && <><label className="field">Reply<textarea maxLength={10_000} value={reply} onChange={e => { setReply(e.target.value); setKey(crypto.randomUUID()); }}/></label><label className="field">Who can read this?<select value={visibility} onChange={e => { setVisibility(e.target.value); setKey(crypto.randomUUID()); }}><option value="customer">Customer and service team</option><option value="internal">Office only</option></select></label><button className="btn btn-primary" disabled={busy || !reply.trim()}>Save reply</button></>}{canClose && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save(true)}>Close ticket</button>}</form>}
  </section>;
}
