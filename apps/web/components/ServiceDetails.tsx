"use client";
import type { PackField } from "@modular-crm/industry-packs";
import { PackDetails } from "./PackFields";

export default function ServiceDetails({ items = [] }: { items?: { id: string; name: string; label: string; pluralLabel: string; fields: PackField[]; customFields: Record<string, unknown>; accessNotes?: string | null }[] }) {
  return <>{items.length ? items.map(item => <div key={item.id} className="card card-pad"><h3>{item.pluralLabel}</h3><strong>{item.name}</strong><PackDetails fields={item.fields.filter(field => field.key !== "name")} values={item.customFields}/>{item.accessNotes && <p>{item.accessNotes}</p>}</div>) : <p className="subtle">No service details recorded.</p>}</>;
}
