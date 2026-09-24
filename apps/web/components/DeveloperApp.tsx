"use client";

import { useState } from "react";
import { api, body, date, friendly, unwrapItem, unwrapItems } from "./api";
import { Badge, Empty, Icon, Loading, Notice, useResource } from "./ui";

type Credential = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

type Webhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: string;
  createdAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

type Delivery = {
  id: string;
  eventType: string;
  status: string;
  attemptCount: number;
  responseStatus: number | null;
  responseExcerpt: string | null;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

type DeveloperData = { credentials?: Credential[]; webhooks?: Webhook[] };
type SecretNotice = { kind: "API key" | "webhook signing secret"; value: string };

const scopes = [
  "customers:read", "customers:write", "leads:read", "leads:write", "jobs:read", "jobs:write",
  "estimates:read", "estimates:write", "invoices:read", "payments:read", "service_plans:read",
  "service_plans:write", "tickets:read", "tickets:write", "webhooks:manage",
];

export default function DeveloperApp() {
  const result = useResource<{ item?: DeveloperData } | DeveloperData>("/developer", { item: {} });
  const data = unwrapItem(result.data) as DeveloperData;
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [credentialName, setCredentialName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["customers:read", "leads:read"]);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState("job.completed");
  const [secret, setSecret] = useState<SecretNotice | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [historyHookId, setHistoryHookId] = useState("");
  const deliveriesResult = useResource<{ items?: Delivery[] }>(
    historyHookId ? `/developer/webhooks/${historyHookId}/deliveries` : null,
    { items: [] },
  );

  function clearMessages() {
    setError("");
    setNotice("");
  }

  async function createCredential(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    setBusy("create-credential");
    try {
      const response = await api<{ item: Credential & { key: string } }>("/developer/credentials", body({
        name: credentialName.trim(), scopes: selectedScopes,
      }));
      const created = unwrapItem(response);
      setSecret({ kind: "API key", value: created.key });
      setCredentialOpen(false);
      setCredentialName("");
      setNotice("API key created. Copy it now; it will not be shown again.");
      result.reload();
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function revokeCredential(credential: Credential) {
    if (!window.confirm(`Revoke the API key “${credential.name}”? Connections using it will stop working.`)) return;
    clearMessages();
    setBusy(`credential-${credential.id}`);
    try {
      await api(`/developer/credentials/${credential.id}`, { method: "DELETE" });
      setNotice(`The API key “${credential.name}” was revoked.`);
      result.reload();
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function createWebhook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    setBusy("create-webhook");
    try {
      const response = await api<{ item: Webhook & { secret: string } }>("/developer/webhooks", body({
        ...(webhookName.trim() ? { name: webhookName.trim() } : {}),
        url: webhookUrl.trim(),
        events: webhookEvents.split(",").map((entry) => entry.trim()).filter(Boolean),
      }));
      const created = unwrapItem(response);
      setSecret({ kind: "webhook signing secret", value: created.secret });
      setWebhookOpen(false);
      setWebhookName("");
      setWebhookUrl("");
      setNotice("Endpoint added. Copy its signing secret now; it will not be shown again.");
      result.reload();
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function sendTest(hook: Webhook) {
    clearMessages();
    setBusy(`test-${hook.id}`);
    try {
      const response = await api<{ item: { reused?: boolean } }>(
        `/developer/webhooks/${hook.id}/test`,
        body({ idempotencyKey: crypto.randomUUID() }),
      );
      const delivery = unwrapItem(response);
      setNotice(delivery.reused ? "This test event was already queued." : "Test event queued for delivery.");
      if (historyHookId === hook.id) deliveriesResult.reload();
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function toggleDeliveryHistory(hook: Webhook) {
    clearMessages();
    if (historyHookId === hook.id) {
      setHistoryHookId("");
      return;
    }
    setHistoryHookId(hook.id);
  }

  async function retryDelivery(hook: Webhook, delivery: Delivery) {
    clearMessages();
    setBusy(`retry-${delivery.id}`);
    try {
      await api(`/developer/webhooks/${hook.id}/deliveries/${delivery.id}/retry`, body({}));
      setNotice("Delivery queued to try again.");
      deliveriesResult.reload();
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function revokeWebhook(hook: Webhook) {
    if (!window.confirm(`Remove “${hook.name}”? New events will no longer be sent to this endpoint.`)) return;
    clearMessages();
    setBusy(`webhook-${hook.id}`);
    try {
      await api(`/developer/webhooks/${hook.id}`, { method: "DELETE" });
      setNotice(`The endpoint “${hook.name}” was removed.`);
      if (historyHookId === hook.id) setHistoryHookId("");
      result.reload();
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      setNotice(`${friendly(secret.kind)} copied to clipboard.`);
    } catch {
      setError("Clipboard access was unavailable. Select and copy the value manually.");
    }
  }

  function toggleScope(scope: string) {
    setSelectedScopes((current) => current.includes(scope)
      ? current.filter((value) => value !== scope)
      : [...current, scope]);
  }

  const credentials = data.credentials ?? [];
  const webhooks = data.webhooks ?? [];

  return <>
    <div className="page-head">
      <div><div className="eyebrow">Connections</div><h1>Developer tools</h1><p>Connect custom software with access keys and event updates.</p></div>
    </div>
    <div className="notice notice-info" style={{ marginBottom: 18 }}>
      These tools are for custom software connections. Most businesses can use Connections instead.
    </div>
    {result.error && <Notice kind="error" text={result.error}/>}
    {error && <Notice kind="error" text={error} onClose={() => setError("")}/>}
    {notice && <Notice kind="success" text={notice} onClose={() => setNotice("")}/>}
    {secret && <div className="notice notice-success" style={{ display: "block", marginBottom: 18 }}>
      <div className="card-heading"><strong>Copy this {secret.kind} now. It will not appear again.</strong><button type="button" className="icon-button" aria-label="Dismiss secret" onClick={() => setSecret(null)}><Icon name="close" size={16}/></button></div>
      <code style={{ display: "block", marginTop: 10, overflowWrap: "anywhere", userSelect: "all" }}>{secret.value}</code>
      <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={copySecret}>Copy {secret.kind}</button>
    </div>}

    {result.loading ? <Loading label="Loading developer tools…"/> : <div className="two-col">
      <section className="card card-pad">
        <div className="card-heading"><div><h2>Access keys</h2><p className="subtle" style={{ fontSize: ".82rem", margin: "5px 0 0" }}>Choose what each connected tool can access.</p></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => { clearMessages(); setCredentialOpen(true); }}><Icon name="plus" size={15}/> Create key</button></div>
        {credentials.length ? <div className="action-list">{credentials.map((credential) => <div className="action-item" key={credential.id} style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><strong>{credential.name}</strong><Badge status={credential.status}/></div>
            <p style={{ overflowWrap: "anywhere" }}>Key starts with <code>{credential.tokenPrefix}</code></p>
            <p>Access: {credential.scopes.join(", ")}</p>
            <p>Created {date(credential.createdAt)} · Last used {credential.lastUsedAt ? date(credential.lastUsedAt) : "Never"}{credential.expiresAt ? ` · Expires ${date(credential.expiresAt)}` : ""}</p>
          </div>
          {credential.status !== "revoked" && <button type="button" className="btn btn-secondary btn-sm" disabled={busy === `credential-${credential.id}`} onClick={() => revokeCredential(credential)}>{busy === `credential-${credential.id}` ? "Revoking…" : "Revoke"}</button>}
        </div>)}</div> : <Empty title="No access keys yet" description="Create a key when a custom tool needs to connect to your business."/>}
      </section>

      <section className="card card-pad">
        <div className="card-heading"><div><h2>Event updates</h2><p className="subtle" style={{ fontSize: ".82rem", margin: "5px 0 0" }}>Send business updates to a custom HTTPS endpoint.</p></div><button type="button" className="btn btn-secondary btn-sm" onClick={() => { clearMessages(); setWebhookOpen(true); }}><Icon name="plus" size={15}/> Add endpoint</button></div>
        {webhooks.length ? <div className="action-list">{webhooks.map((hook) => <div className="action-item" key={hook.id} style={{ display: "block" }}>
          <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start" }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><strong>{hook.name}</strong><Badge status={hook.status}/></div><p style={{ overflowWrap: "anywhere" }}>{hook.url}</p><p>Events: {hook.events.join(", ")}</p><p>Added {date(hook.createdAt)} · Last successful delivery {hook.lastSuccessAt ? date(hook.lastSuccessAt) : "None"}</p></div></div>
          <div className="inline-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy === `test-${hook.id}` || hook.status !== "active"} onClick={() => sendTest(hook)}>{busy === `test-${hook.id}` ? "Sending…" : "Send test event"}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleDeliveryHistory(hook)}>{historyHookId === hook.id ? "Hide delivery history" : "Delivery history"}</button>
            {hook.status !== "revoked" && <button type="button" className="btn btn-secondary btn-sm" disabled={busy === `webhook-${hook.id}`} onClick={() => revokeWebhook(hook)}>{busy === `webhook-${hook.id}` ? "Removing…" : "Remove endpoint"}</button>}
          </div>
          {historyHookId === hook.id && <div style={{ marginTop: 14 }}>
            {deliveriesResult.loading ? <Loading label="Loading delivery history…"/> : deliveriesResult.error ? <Notice kind="error" text={deliveriesResult.error}/> : unwrapItems(deliveriesResult.data).length ? <div className="table-wrap"><table><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Last response</th><th>Created</th><th></th></tr></thead><tbody>{unwrapItems(deliveriesResult.data).map((delivery) => <tr key={delivery.id}>
              <td>{delivery.eventType}</td><td><Badge status={delivery.status}/></td><td>{delivery.attemptCount}</td><td>{delivery.responseStatus ?? "—"}{delivery.responseExcerpt ? <small style={{ display: "block", maxWidth: 220, overflowWrap: "anywhere" }}>{delivery.responseExcerpt}</small> : null}</td><td>{date(delivery.createdAt)}</td><td>{(delivery.status === "failed" || delivery.status === "retry") && (hook.status === "active" || hook.status === "needs_attention") && <button type="button" className="btn btn-secondary btn-sm" disabled={busy === `retry-${delivery.id}`} onClick={() => retryDelivery(hook, delivery)}>{busy === `retry-${delivery.id}` ? "Queueing…" : "Try again"}</button>}</td>
            </tr>)}</tbody></table></div> : <Empty title="No deliveries yet" description="Test events and matching business updates will appear here."/>}
          </div>}
        </div>)}</div> : <Empty title="No endpoints yet" description="Add an endpoint when a custom tool needs to receive business updates."/>}
      </section>
    </div>}

    {credentialOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCredentialOpen(false); }}><div role="dialog" aria-modal="true" aria-label="Create access key" className="modal">
      <div className="modal-heading"><h2>Create access key</h2><button className="icon-button" type="button" onClick={() => setCredentialOpen(false)} aria-label="Close"><Icon name="close"/></button></div>
      <form onSubmit={createCredential}><div className="stack">
        <div className="field"><label htmlFor="developer-key-name">Name</label><input id="developer-key-name" value={credentialName} required maxLength={100} onChange={(event) => setCredentialName(event.target.value)} placeholder="Reporting dashboard"/></div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontWeight: 600, marginBottom: 10 }}>Access scopes</legend><div className="form-grid">{scopes.map((scope) => <label key={scope} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: ".85rem" }}><input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)}/>{scope}</label>)}</div></fieldset>
      </div>{error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setCredentialOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy === "create-credential" || selectedScopes.length === 0}>{busy === "create-credential" ? "Creating…" : "Create key"}</button></div></form>
    </div></div>}

    {webhookOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setWebhookOpen(false); }}><div role="dialog" aria-modal="true" aria-label="Add event endpoint" className="modal">
      <div className="modal-heading"><h2>Add event endpoint</h2><button className="icon-button" type="button" onClick={() => setWebhookOpen(false)} aria-label="Close"><Icon name="close"/></button></div>
      <form onSubmit={createWebhook}><div className="stack">
        <div className="field"><label htmlFor="developer-hook-name">Name <span className="subtle">(optional)</span></label><input id="developer-hook-name" value={webhookName} maxLength={100} onChange={(event) => setWebhookName(event.target.value)} placeholder="Operations dashboard"/></div>
        <div className="field"><label htmlFor="developer-hook-url">HTTPS endpoint</label><input id="developer-hook-url" type="url" value={webhookUrl} required onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/events"/></div>
        <div className="field"><label htmlFor="developer-hook-events">Events (comma separated)</label><input id="developer-hook-events" value={webhookEvents} required onChange={(event) => setWebhookEvents(event.target.value)} placeholder="job.completed, invoice.issued"/><small>Use event names such as <code>job.completed</code>, or <code>*</code> for all events.</small></div>
      </div>{error && <Notice kind="error" text={error}/>}<div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setWebhookOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy === "create-webhook"}>{busy === "create-webhook" ? "Adding…" : "Add endpoint"}</button></div></form>
    </div></div>}
  </>;
}
