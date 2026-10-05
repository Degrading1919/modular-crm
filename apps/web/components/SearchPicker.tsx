"use client";

import { useEffect, useId, useState } from "react";
import { api } from "./api";
import { Notice } from "./ui";

export type PickerRecord = { id: string; [key: string]: unknown };

/** Scoped remote results, never an unfiltered customer catalog downloaded to the form. */
export default function SearchPicker({ label, endpoint, selected, describe, onSelect, required = false }: {
  label: string; endpoint: string; selected: PickerRecord | null; describe: (item: PickerRecord) => string;
  onSelect: (item: PickerRecord | null) => void; required?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PickerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let current = true;
    setItems([]); setLoading(true); setError(""); setActive(-1);
    api<{ items: PickerRecord[] }>(`${endpoint}${endpoint.includes("?") ? "&" : "?"}search=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((result) => { if (current) setItems(result.items); })
      .catch((issue: Error) => { if (current && issue.name !== "AbortError") setError(issue.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [endpoint, query, open]);
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);
  function choose(item: PickerRecord) { onSelect(item); setOpen(false); setQuery(""); setActive(-1); }
  return <div className="field full">
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-results`}
      aria-activedescendant={open && active >= 0 && items[active] ? `${id}-option-${active}` : undefined}
      autoComplete="off" required={required} maxLength={selected ? undefined : 120}
      placeholder={`Search ${label.toLowerCase()}`} value={selected ? describe(selected) : query}
      onFocus={() => { if (!selected) setOpen(true); }}
      onChange={(event) => { onSelect(null); setQuery(event.target.value); setItems([]); setActive(-1); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          setActive((previous) => items.length ? Math.max(0, Math.min(items.length - 1, previous + (event.key === "ArrowDown" ? 1 : -1))) : -1);
        } else if (event.key === "Enter" && open) {
          event.preventDefault(); if (items[active]) choose(items[active]);
        } else if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); }
      }}/>
    {selected && <button type="button" className="link" style={{ alignSelf: "start", minHeight: 36 }} onClick={() => { onSelect(null); setQuery(""); setOpen(true); document.getElementById(id)?.focus(); }}>Change {label.toLowerCase()}</button>}
    {open && <div id={`${id}-results`} role="listbox" aria-label={`${label} choices`} style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
      {items.map((item, index) => <button type="button" role="option" aria-selected={active === index} id={`${id}-option-${index}`} key={item.id}
        className="btn btn-secondary" style={{ display: "block", width: "100%", textAlign: "left", whiteSpace: "normal", minHeight: 44, background: active === index ? "#edf6e8" : undefined }}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>{describe(item)}</button>)}
      {!items.length && <p role="status" className="subtle" style={{ padding: 12, margin: 0 }}>{loading ? "Searching…" : error ? "Search unavailable" : "No matches. Try another name or detail."}</p>}
    </div>}
    {error && <Notice kind="error" text={error}/>}
  </div>;
}
