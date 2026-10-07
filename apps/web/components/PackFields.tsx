"use client";
import type { PackField } from "@modular-crm/industry-packs";

export function PackFields({ fields, values, onChange, prefix = "detail", labelPrefix = "" }: { fields: readonly PackField[]; values: Record<string, unknown>; onChange: (key: string, value: string | number | boolean) => void; prefix?: string; labelPrefix?: string }) {
  return <>{fields.map(field => {
    const value = values[field.key] ?? field.defaultValue ?? "";
    const id = `${prefix}-${field.key}`;
    const label = `${labelPrefix}${labelPrefix && field.key === "name" ? field.label.toLowerCase() : field.label}`;
    return <div className="field" key={field.key}><label htmlFor={id}>{label}{field.sensitive && !field.required ? " (optional)" : ""}</label>{field.type === "enum" ? <select id={id} required={field.required} value={String(value)} onChange={event => onChange(field.key, event.target.value)}><option value="">Choose an option</option>{field.options?.map(option => <option value={option} key={option}>{option.replaceAll("_", " ").replace(/^./, c => c.toUpperCase())}</option>)}</select> : field.type === "boolean" ? <input id={id} type="checkbox" checked={Boolean(value)} onChange={event => onChange(field.key, event.target.checked)}/> : <input id={id} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} min={field.type === "number" ? 0 : undefined} maxLength={field.sensitive ? 2000 : 1000} required={field.required} value={String(value)} onChange={event => onChange(field.key, field.type === "number" ? Number(event.target.value) : event.target.value)}/>}{field.sensitive && <small>Only your assigned service team will see this.</small>}</div>;
  })}</>;
}

export function PackDetails({ fields, values }: { fields: readonly PackField[]; values: Record<string, unknown> }) {
  return <>{fields.filter(field => !field.sensitive && values[field.key] !== undefined && values[field.key] !== "").map(field => <div className="detail-list" key={field.key}><dt>{field.label}</dt><dd>{typeof values[field.key] === "boolean" ? values[field.key] ? "Yes" : "No" : String(values[field.key])}</dd></div>)}</>;
}
