"use client";

import Link from "next/link";
import { date, friendly, money, unwrapItems } from "./api";
import { Badge, Empty, Loading, Notice, useResource } from "./ui";

type PortalRecord = Record<string, any> & { id: string };

export default function PortalDocuments() {
  const invoices = useResource<{ items?: PortalRecord[] }>("/portal/invoices", { items: [] });
  const estimates = useResource<{ items?: PortalRecord[] }>("/portal/estimates", { items: [] });
  const visits = useResource<{ items?: PortalRecord[] }>("/portal/visits", { items: [] });
  const payments = useResource<{ items?: PortalRecord[] }>("/portal/payments", { items: [] });

  const invoiceRows = unwrapItems(invoices.data);
  const estimateRows = unwrapItems(estimates.data);
  const visitRows = unwrapItems(visits.data);
  const paymentRows = unwrapItems(payments.data);
  const customerIds = [...new Set(invoiceRows.map((invoice) => String(invoice.customerId ?? "")).filter(Boolean))];

  return <main className="portal-app">
    <header className="portal-top"><div className="portal-top-inner"><Link href="/portal/home" aria-label="Back to customer home">Modular CRM</Link><nav className="portal-nav" aria-label="Customer account"><Link href="/portal/home">Home</Link><Link href="/portal/services">Services</Link><Link href="/portal/billing">Billing</Link><Link href="/portal/documents" className="active">Documents</Link></nav></div></header>
    <section className="portal-content">
      <div className="page-head"><div><div className="eyebrow">Your account</div><h1>Documents</h1><p>View and print estimates, invoices, receipts, and service reports.</p></div></div>
      {[invoices, estimates, visits, payments].some((result) => result.error) && <Notice kind="error" text={[invoices, estimates, visits, payments].map((result) => result.error).filter(Boolean).join(" ")}/>}
      {[invoices, estimates, visits, payments].some((result) => result.loading) ? <Loading label="Loading your documents…"/> : <div className="stack">
        <section className="card card-pad"><div className="card-heading"><div><h2>Account statements</h2><p className="subtle" style={{ fontSize: ".84rem", margin: "4px 0 0" }}>Choose a period to review invoices, payments, refunds, and credits.</p></div></div>
          {customerIds.length ? <div className="inline-actions">{customerIds.map((customerId) => <Link className="btn btn-secondary btn-sm" key={customerId} href={`/portal/documents/statement/${customerId}`}>View account statement</Link>)}</div> : <Empty title="No statement available" description="Statements appear after your first invoice."/>}
        </section>
        <DocumentGroup title="Estimates" empty="Estimates shared by your service team will appear here." items={estimateRows} render={(item) => <DocumentRow key={item.id} title={item.title || `Estimate ${item.number || ""}`} detail={`${friendly(item.status)} · ${money(item.totalCents)}`} href={`/portal/documents/estimate/${item.id}`}/>}/>
        <DocumentGroup title="Invoices" empty="Invoices from your service team will appear here." items={invoiceRows} render={(item) => <DocumentRow key={item.id} title={`Invoice ${item.number || ""}`} detail={`${friendly(item.status)} · ${money(item.totalCents)} · Due ${date(item.dueDate)}`} href={`/portal/documents/invoice/${item.id}`}/>}/>
        <DocumentGroup title="Payment receipts" empty="Successful payments will appear here as receipts." items={paymentRows} render={(item) => <DocumentRow key={item.id} title={`Receipt ${String(item.id).slice(0, 8).toUpperCase()}`} detail={`${date(item.receivedAt || item.createdAt)} · ${money(item.amountCents, item.currency)}`} href={`/portal/documents/receipt/${item.id}`}/>}/>
        <DocumentGroup title="Service completion reports" empty="Completed visits will appear here when your service team shares them." items={visitRows} render={(item) => <DocumentRow key={item.id} title={`${item.serviceName || "Service visit"} · ${date(item.completedAt || item.scheduledDate)}`} detail={item.address || item.summary || "Completed service"} href={`/portal/documents/completion/${item.id}`}><Badge status={item.status}/></DocumentRow>}/>
      </div>}
    </section>
  </main>;
}

function DocumentGroup({ title, empty, items, render }: { title: string; empty: string; items: PortalRecord[]; render(item: PortalRecord): React.ReactNode }) {
  return <section className="card card-pad"><h2>{title}</h2>{items.length ? <div className="action-list">{items.map(render)}</div> : <Empty title={`No ${title.toLowerCase()} yet`} description={empty}/>}</section>;
}

function DocumentRow({ title, detail, href, children }: { title: string; detail: string; href: string; children?: React.ReactNode }) {
  return <div className="action-item"><div style={{ flex: 1, minWidth: 0 }}><strong>{title}</strong><p>{detail}</p></div>{children}<Link className="btn btn-secondary btn-sm" href={href}>View & print</Link></div>;
}
