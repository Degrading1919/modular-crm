"use client";
import { useState } from "react";
import { api, body, patch } from "./api";
import { useResource } from "./ui";

/** One hosted setup action; credentials and verification details never enter this component. */
export default function OnlinePaymentSetup({ provider, mayManage }: { provider: string; mayManage: boolean }) {
  const endpoint = `/connections/${encodeURIComponent(provider)}/online-payments`;
  const result = useResource<{ item: { status?: string; message?: string; allowPartial?: boolean; detailsNeeded?: boolean } }>(mayManage ? endpoint : "", { item: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connected = result.data.item.status === "connected";
  async function start() {
    setBusy(true); setError("");
    try {
      const response = await api<{ item: { authorizationUrl: string } }>(endpoint, body({}));
      const target = new URL(response.item.authorizationUrl);
      const allowed = provider === "mock-payments" ? target.origin === window.location.origin : target.protocol === "https:" && target.hostname === "connect.stripe.com";
      if (!allowed || target.username || target.password) throw new Error("The payment setup page is unavailable. Please try again.");
      window.location.assign(target.toString());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Payment setup is unavailable."); setBusy(false); }
  }
  async function toggle(allowPartial: boolean) {
    setBusy(true); setError("");
    try { await api(endpoint, patch({ allowPartial })); result.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Payment settings could not be saved."); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!window.confirm("Stop new online payments for this business? Existing payments and confirmations will stay in your history.")) return;
    setBusy(true); setError("");
    try { await api(endpoint, { method: "DELETE" }); result.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Online payments could not be disconnected."); }
    finally { setBusy(false); }
  }
  if (!mayManage) return <p className="muted-label">Ask the business owner to set up online payments.</p>;
  return <div data-online-payment-provider={provider}>
    <p role="status" className="muted-label">{result.loading ? "Checking online payments…" : result.data.item.message || "Set up online payments for this business."}</p>
    {(error || result.error) && <p role="alert" className="notice notice-error">{error || result.error}</p>}
    {(!connected || result.data.item.detailsNeeded) && <button type="button" className="btn btn-primary btn-sm" onClick={start} disabled={busy || result.loading}>{busy ? "Opening setup…" : connected ? "Finish payment setup" : "Set up online payments"}</button>}
    {connected && <label className="checkbox-row"><input type="checkbox" checked={result.data.item.allowPartial === true} disabled={busy} onChange={(event) => toggle(event.target.checked)}/>Allow customers to make partial invoice payments</label>}
    {connected && <button type="button" className="btn btn-secondary btn-sm" onClick={() => result.reload()} disabled={busy}>Check payment status</button>}
    {connected && <button type="button" className="btn btn-secondary btn-sm" onClick={disconnect} disabled={busy}>Disconnect online payments</button>}
  </div>;
}
