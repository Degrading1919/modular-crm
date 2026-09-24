"use client";

import { useEffect, useState } from "react";
import { api, friendly } from "./api";

type IconName = "grid" | "users" | "calendar" | "route" | "briefcase" | "receipt" | "chart" | "globe" | "plug" | "settings" | "spark" | "bell" | "menu" | "close" | "arrow" | "plus" | "check" | "clock" | "map" | "wallet" | "search" | "chevron" | "external" | "download" | "person" | "shield" | "box" | "ticket" | "send" | "building" | "time" | "more" | "warning" | "refresh";

const paths: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  route: <><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6"/></>,
  briefcase: <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M2 12h20"/></>,
  receipt: <><path d="M4 2h16v20l-4-2-4 2-4-2-4 2zM8 7h8M8 11h8M8 15h5"/></>,
  chart: <><path d="M3 3v18h18M7 16l4-5 4 2 5-7"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
  plug: <><path d="M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0zM12 17v4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.85 1.85-.06-.06A1.7 1.7 0 0 0 16 18.4a1.7 1.7 0 0 0-1 1.55V20H9v-.05A1.7 1.7 0 0 0 8 18.4a1.7 1.7 0 0 0-1.88.34l-.06.06-1.85-1.85.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3v-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88L4.2 7.06l1.85-1.85.06.06A1.7 1.7 0 0 0 8 5.6 1.7 1.7 0 0 0 9 4.05V4h6v.05A1.7 1.7 0 0 0 16 5.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.85 1.85-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21v4h-.05A1.7 1.7 0 0 0 19.4 15z"/></>,
  spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7zM20 18l.5 1.5L22 20l-1.5.5L20 22l-.5-1.5L18 20l1.5-.5z"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  close: <path d="M5 5l14 14M19 5 5 19"/>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  check: <path d="m4 12 5 5L20 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  map: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/></>,
  wallet: <><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 10h18M6 6V4a1 1 0 0 1 1-1h11"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  external: <><path d="M13 4h7v7M20 4l-9 9"/><path d="M20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6"/></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/></>,
  person: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  shield: <><path d="M12 2 4 5v6c0 5 3 9 8 11 5-2 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/></>,
  box: <><path d="m12 2 9 5-9 5-9-5zM3 7v10l9 5 9-5V7M12 12v10"/></>,
  ticket: <><path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4zM12 5v14"/></>,
  send: <><path d="m22 2-7 20-4-9-9-4zM11 13 22 2"/></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-4h4v4"/></>,
  time: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  warning: <><path d="M12 3 2 21h20zM12 9v5M12 18h.01"/></>,
  refresh: <><path d="M20 11a8 8 0 1 0-.7 4M20 4v7h-7"/></>,
};

export function Icon({ name, size = 19, className = "" }: { name: IconName; size?: number; className?: string }) {
  return <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function Logo({ light = false }: { light?: boolean }) {
  return <span className={`brand ${light ? "brand-light" : ""}`}><span className="brand-mark">M</span><span>modular<span className="brand-dot">.</span></span></span>;
}

export function Badge({ status }: { status?: string | null }) {
  const normalized = (status || "unknown").toLowerCase().replaceAll("_", "-");
  const tone = /paid|active|completed|published|connected|approved|delivered|succeeded|eligible/.test(normalized) ? "good" : /failed|overdue|skipped|canceled|expired|blocked|error|needs-attention|declined/.test(normalized) ? "bad" : /pending|draft|scheduled|review|new|paused|dispatched|unscheduled|sent|open|demo/.test(normalized) ? "warm" : "neutral";
  return <span className={`badge badge-${tone}`}><span className="badge-dot"/>{friendly(status)}</span>;
}

export function Empty({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Icon name="spark" size={24}/></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Notice({ text, kind = "info", onClose }: { text: string; kind?: "info" | "success" | "error"; onClose?: () => void }) {
  return <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}><span>{text}</span>{onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="Dismiss"><Icon name="close" size={15}/></button>}</div>;
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-label={title} className="modal"><div className="modal-heading"><h2>{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><Icon name="close"/></button></div>{children}</div></div>;
}

export function useResource<T>(path: string | null, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return;
    let active = true;
    setLoading(true);
    api<T>(path).then((result) => { if (active) { setData(result); setError(""); } }).catch((issue) => { if (active) setError(issue.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, version]);
  return { data, loading, error, setData, reload: () => setVersion((current) => current + 1) };
}

export function Loading({ label = "Loading your workspace…" }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner"/><span>{label}</span></div>;
}
