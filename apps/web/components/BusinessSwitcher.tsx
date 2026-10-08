"use client";

import { useState } from "react";
import { api, body, friendly } from "./api";
import { Modal, Notice, useResource } from "./ui";

type Business = { id: string; name: string; organizationName: string; role: string };

export default function BusinessSwitcher({ beforeSwitch }: { beforeSwitch?: () => boolean } = {}) {
  const businesses = useResource<{ items: Business[] }>("/auth/businesses", { items: [] });
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function select(id: string) {
    if (beforeSwitch && !beforeSwitch()) return;
    setSaving(true); setError("");
    try {
      const result = await api<{ destination: string }>("/auth/switch-business", body({ membershipId: id }));
      // Reload all identity-scoped resources; never retain the previous business's UI.
      window.location.href = result.destination;
    } catch (issue) { setError((issue as Error).message); setSaving(false); businesses.reload(); }
  }
  if (!open && (businesses.loading || businesses.error || businesses.data.items.length < 2)) return null;
  return <>
    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setOpen(true); businesses.reload(); }}>Switch business</button>
    {open && <Modal title="Switch business" onClose={() => { if (!saving) setOpen(false); }}>
      <p>Choose the business you want to work in.</p>
      {(error || businesses.error) && <Notice kind="error" text={error || businesses.error}/>}
      <div className="stack">{businesses.data.items.map(item => <button type="button" className="btn btn-secondary" key={item.id} disabled={saving || businesses.loading} onClick={() => void select(item.id)}>
        {item.name}{item.organizationName !== item.name ? ` · ${item.organizationName}` : ""} · {friendly(item.role)}
      </button>)}</div>
    </Modal>}
  </>;
}
