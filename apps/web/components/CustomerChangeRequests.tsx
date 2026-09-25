"use client";

import { useState } from "react";
import { api, body, date, friendly, unwrapItems } from "./api";
import { Badge, Empty, Loading, Notice, useResource } from "./ui";

type RequestItem = { id: string; customerName: string; serviceAddress?: string; type: string; status: string; details?: string; requestedChanges?: Record<string, unknown>; createdAt: string };

export default function CustomerChangeRequests() {
  const result = useResource<{ items: RequestItem[] }>("/customer-change-requests", { items: [] });
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  async function transition(item: RequestItem, action: "review" | "approve" | "reject") {
    let reason: string | undefined;
    if (action === "reject") reason = window.prompt("Optional message for the customer", "") || undefined;
    if (action === "approve" && !window.confirm(`Approve this ${item.type} request from ${item.customerName}?`)) return;
    setBusy(item.id); setError(""); setNotice("");
    try {
      const outcome = await api<{ item: { appliedChanges?: { operationalChangeApplied?: boolean } } }>(`/customer-change-requests/${item.id}/${action}`, body({ reason }));
      setNotice(action === "review" ? "Request moved into review." : action === "approve"
        ? outcome.item.appliedChanges?.operationalChangeApplied ? "Request approved and the service plan updated." : "Request approved. Follow up with the customer to confirm the change."
        : "Customer request declined.");
      result.reload();
    } catch (issue) { setError((issue as Error).message); }
    finally { setBusy(""); }
  }
  const items = unwrapItems(result.data);
  return <section className="card card-pad" aria-label="Customer change requests" style={{ marginBottom: 16 }}>
    <div className="card-heading"><div><h2 style={{ margin: 0 }}>Customer change requests</h2><p className="subtle" style={{ margin: "4px 0 0", fontSize: ".84rem" }}>Review portal requests. Plan updates take effect when approved; custom requests need a follow-up.</p></div></div>
    {(error || result.error) && <Notice kind="error" text={error || result.error!}/>} {notice && <Notice kind="success" text={notice}/>}
    {result.loading ? <Loading label="Loading customer requests…"/> : items.length ? <div className="stack">{items.map((item) => <div className="card card-pad" key={item.id} style={{ background: "var(--surface, #fff)" }}>
      <div className="card-heading"><div><h3 style={{ margin: 0 }}>{friendly(item.type)} · {item.customerName}</h3><p className="subtle" style={{ fontSize: ".82rem", margin: "4px 0 0" }}>{item.serviceAddress || "Customer request"} · {date(item.createdAt)}</p></div><Badge status={item.status}/></div>
      <p style={{ fontSize: ".88rem", whiteSpace: "pre-wrap" }}>{item.details || "No extra details provided."}</p>
      {item.status === "submitted" && <button className="btn btn-secondary btn-sm" type="button" disabled={busy === item.id} onClick={() => transition(item, "review")}>{busy === item.id ? "Saving…" : "Start review"}</button>}
      {item.status === "reviewing" && <div className="inline-actions"><button className="btn btn-secondary btn-sm" type="button" disabled={busy === item.id} onClick={() => transition(item, "reject")}>Decline</button><button className="btn btn-primary btn-sm" type="button" disabled={busy === item.id} onClick={() => transition(item, "approve")}>Approve request</button></div>}
    </div>)}</div> : <Empty title="No customer change requests" description="Requests submitted from the customer portal will appear here."/>}
  </section>;
}
