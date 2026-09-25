"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, body, date, friendly, money, unwrapItems } from "./api";
import { Badge, Empty, Icon, Loading, Logo, Notice, useResource } from "./ui";

type PortalRecord = Record<string, any> & { id: string };

export default function PortalDocuments() {
  const router = useRouter();
  async function logout() {
    try { await api("/auth/logout", body({})); } finally { router.push("/login"); }
  }
  const invoices = useResource<{ items?: PortalRecord[] }>("/portal/invoices", { items: [] });
  const estimates = useResource<{ items?: PortalRecord[] }>("/portal/estimates", { items: [] });
  const visits = useResource<{ items?: PortalRecord[] }>("/portal/visits", { items: [] });
  const payments = useResource<{ items?: PortalRecord[] }>("/portal/payments", { items: [] });

  const invoiceRows = unwrapItems(invoices.data);
  const estimateRows = unwrapItems(estimates.data);
  const visitRows = unwrapItems(visits.data);
  const paymentRows = unwrapItems(payments.data);
  const customerIds = [...new Set(invoiceRows.map((invoice) => String(invoice.customerId ?? "")).filter(Boolean))];

  const navigation = [
    { href: "/portal/home", label: "Home", icon: "grid" },
    { href: "/portal/services", label: "Services", icon: "calendar" },
    { href: "/portal/estimates", label: "Estimates", icon: "receipt" },
    { href: "/portal/billing", label: "Billing", icon: "wallet" },
    { href: "/portal/requests", label: "Requests", icon: "ticket" },
    { href: "/portal/files", label: "Files", icon: "download" },
    { href: "/portal/documents", label: "Documents", icon: "receipt" },
    { href: "/portal/profile", label: "Profile", icon: "person" },
  ] as const;

  return <div className="portal-app">
    <header className="portal-top"><div className="portal-top-inner"><Link href="/portal/home" aria-label="Customer home"><Logo/></Link><nav className="portal-nav" aria-label="Customer account">{navigation.map((item) => <Link key={item.href} href={item.href} className={item.href === "/portal/documents" ? "active" : ""} aria-current={item.href === "/portal/documents" ? "page" : undefined}>{item.label}</Link>)}</nav><button type="button" className="btn btn-secondary btn-sm" onClick={logout}>Sign out</button></div></header>
    <main className="portal-content">
      <div className="page-head"><div><div className="eyebrow">Your account</div><h1>Documents</h1><p>View and print estimates, invoices, receipts, and service reports.</p></div></div>
      {[invoices, estimates, visits, payments].some((result) => result.error) && <Notice kind="error" text={[invoices, estimates, visits, payments].map((result) => result.error).filter(Boolean).join(" ")}/>}
      {[invoices, estimates, visits, payments].some((result) => result.loading) ? <Loading label="Loading your documents…"/> : <div className="stack">
        <section aria-labelledby="statements-heading"><div className="section-title" style={{ marginTop: 0 }}><div><h2 id="statements-heading">Account statements</h2><p className="subtle" style={{ fontSize: ".84rem", margin: "4px 0 0" }}>Review invoices, payments, refunds, and credits by period.</p></div></div>
          {customerIds.length ? <div className="inline-actions">{customerIds.map((customerId) => <Link className="btn btn-secondary btn-sm" key={customerId} href={`/portal/documents/statement/${customerId}`}>View account statement</Link>)}</div> : <Empty title="No statement available" description="Statements appear after your first invoice."/>}
        </section>
        <DocumentGroup title="Estimates" empty="Estimates shared by your service team will appear here." items={estimateRows} render={(item) => <DocumentRow key={item.id} title={item.title || `Estimate ${item.number || ""}`} detail={`${friendly(item.status)} · ${money(item.totalCents)}`} href={`/portal/documents/estimate/${item.id}`} action="View estimate"/>}/>
        <DocumentGroup title="Invoices" empty="Invoices from your service team will appear here." items={invoiceRows} render={(item) => <DocumentRow key={item.id} title={`Invoice ${item.number || ""}`} detail={`${friendly(item.status)} · ${money(item.totalCents)}${Number(item.balanceCents || 0) > 0 ? ` · ${money(item.balanceCents)} remaining` : ""}${item.dueDate ? ` · Due ${date(item.dueDate)}` : ""}`} href={`/portal/documents/invoice/${item.id}`} action="View invoice"/>}/>
        <DocumentGroup title="Payment receipts" empty="Successful payments will appear here as receipts." items={paymentRows} render={(item) => <DocumentRow key={item.id} title={`Receipt ${String(item.id).slice(0, 8).toUpperCase()}`} detail={`${date(item.receivedAt || item.createdAt)} · ${money(item.amountCents, item.currency)}`} href={`/portal/documents/receipt/${item.id}`}/>}/>
        <DocumentGroup title="Service completion reports" empty="Completed visits will appear here when your service team shares them." items={visitRows} render={(item) => <DocumentRow key={item.id} title={`${item.serviceName || "Service visit"} · ${date(item.completedAt || item.scheduledDate)}`} detail={item.address || item.summary || "Completed service"} href={`/portal/documents/completion/${item.id}`}><Badge status={item.status}/></DocumentRow>}/>
      </div>}
    </main>
    <nav className="portal-mobile-nav" aria-label="Customer account" style={{ justifyContent: "flex-start", overflowX: "auto" }}>{navigation.map((item) => <Link key={item.href} href={item.href} className={item.href === "/portal/documents" ? "active" : ""} aria-current={item.href === "/portal/documents" ? "page" : undefined} style={{ flex: "0 0 auto", minWidth: 56 }}><Icon name={item.icon} size={20}/>{item.label}</Link>)}</nav>
  </div>;
}

function DocumentGroup({ title, empty, items, render }: { title: string; empty: string; items: PortalRecord[]; render(item: PortalRecord): React.ReactNode }) {
  return <section aria-label={title}><div className="section-title"><h2>{title}</h2></div>{items.length ? <div className="action-list">{items.map(render)}</div> : <Empty title={`No ${title.toLowerCase()} yet`} description={empty}/>}</section>;
}

function DocumentRow({ title, detail, href, children, action = "Open" }: { title: string; detail: string; href: string; children?: React.ReactNode; action?: string }) {
  return <div className="action-item"><div style={{ flex: 1, minWidth: 0 }}><strong>{title}</strong><p>{detail}</p></div>{children}<Link className="btn btn-secondary btn-sm" href={href}>{action}</Link></div>;
}
