"use client";
import { useEffect, useState } from "react";
import { api, body } from "./api";
import { Loading, Notice, useResource } from "./ui";

type Address = { line1: string; line2?: string; city: string; region: string; postalCode: string; countryCode: string };
export default function EstimateServiceAddress({ estimate, canEdit, onDone }: { estimate: { id: string; updatedAt: string }; canEdit: boolean; onDone: () => void }) {
  const source = useResource<{ item: { ready: boolean; address: Partial<Address>; sourceUpdatedAt: string | null } }>(`/estimates/${estimate.id}/service-address`, { item: { ready: false, address: {}, sourceUpdatedAt: null } });
  const [address, setAddress] = useState<Address>({ line1: "", city: "", region: "", postalCode: "", countryCode: "US" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { setAddress({ line1: "", city: "", region: "", postalCode: "", countryCode: "US", ...source.data.item.address }); }, [source.data.item.address]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`/estimates/${estimate.id}/service-address`, body({ address, expectedUpdatedAt: new Date(estimate.updatedAt).toISOString(), sourceUpdatedAt: source.data.item.sourceUpdatedAt })); source.reload(); onDone(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  if (source.loading) return <Loading label="Checking service address…"/>;
  if (source.error) return <Notice kind="error" text={source.error}/>;
  if (source.data.item.ready) return <section className="card card-pad" aria-label="Estimate service address"><h2>Service address</h2><p>{[address.line1, address.city, address.region, address.postalCode].filter(Boolean).join(", ")}</p></section>;
  return <section className="card card-pad" aria-label="Estimate service address"><h2>Add the service address</h2><p>Add a complete service address here before sending or approving this estimate. The customer can then approve without calling the office.</p>{canEdit ? <form onSubmit={save}>
    {([["Street address", "line1"], ["Address line 2", "line2"], ["City", "city"], ["State or region", "region"], ["Postal code", "postalCode"], ["Country code", "countryCode"]] as const).map(([label, key]) => <label className="field" key={key}>{label}<input required={key !== "line2"} maxLength={key === "countryCode" ? 2 : 200} value={address[key] ?? ""} onChange={event => setAddress({ ...address, [key]: key === "countryCode" ? event.target.value.toUpperCase() : event.target.value })}/></label>)}
    {error && <Notice kind="error" text={error}/>}<button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save service address"}</button>
  </form> : <p>Ask a team member who can edit this customer or lead to add the address.</p>}</section>;
}
