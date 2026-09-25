"use client";

import type { CustomerDocument, DocumentLine } from "../../../../../lib/api/documents";

function formatMoney(value: number | string | bigint | null | undefined, currency = "USD") {
  const minor = Number(value ?? 0);
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
}

export default function DocumentViewer({ document, backHref = "/app", routePath }: { document: CustomerDocument; backHref?: string; routePath?: string }) {
  const currencies = document.totals.map((total) => total.currency).filter(Boolean);
  const currency = currencies[0] ?? "USD";
  return <main className="document-shell">
    <nav className="document-toolbar" aria-label="Document actions">
      <a href={backHref}>{backHref === "/portal" ? "Back to portal" : "Back to app"}</a>
      {document.kind === "statement" && routePath && <form action={routePath} method="get" className="period-picker"><label htmlFor="statement-period">Statement month</label><input id="statement-period" type="month" name="period" defaultValue={document.period?.start.slice(0, 7)} /><button type="submit">View statement</button></form>}
      <button type="button" onClick={() => window.print()}>Print</button>
    </nav>
    <article className="document-paper">
      <header className="document-header">
        <div><p className="document-eyebrow">{document.business.name}</p><h1>{document.title}</h1><p>{document.number}</p></div>
        <div className="document-meta"><strong>{document.status}</strong><span>{document.date ?? ""}</span></div>
      </header>
      <div className="document-parties">
        <section><h2>From</h2><p>{document.business.name}</p>{document.business.address && <p>{document.business.address}</p>}{document.business.email && <p>{document.business.email}</p>}{document.business.phone && <p>{document.business.phone}</p>}</section>
        {document.customer && <section><h2>For</h2><p>{document.customer.name}</p>{document.customer.address && <p>{document.customer.address}</p>}{document.customer.email && <p>{document.customer.email}</p>}</section>}
        {document.period && <section><h2>Period</h2><p>{document.period.start} – {document.period.end}</p></section>}
      </div>
      {document.summary && <p className="document-summary">{document.summary}</p>}
      {document.lines.length > 0 && <table className="document-lines"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th className="money">Amount</th></tr></thead><tbody>
        {document.lines.map((line: DocumentLine, index) => <tr key={`${line.description}-${index}`}><td>{line.description}</td><td>{line.quantity ?? ""}</td><td>{line.amountMinor == null ? "" : formatMoney(line.amountMinor, line.currency ?? currency)}</td><td className="money">{line.totalMinor == null ? "" : formatMoney(line.totalMinor, line.currency ?? currency)}</td></tr>)}
      </tbody></table>}
      {document.proofPhotoUrl && <p><a href={document.proofPhotoUrl} target="_blank" rel="noreferrer">View service photo</a></p>}
      {document.totals.length > 0 && <dl className="document-totals">{document.totals.map((total) => <div key={total.label}><dt>{total.label}</dt><dd>{formatMoney(total.amountMinor, total.currency ?? currency)}</dd></div>)}</dl>}
      {document.terms && <section className="document-terms"><h2>Terms</h2><p>{document.terms}</p></section>}
      <footer>Thank you for your business.</footer>
    </article>
    <style jsx>{`
      .document-shell{min-height:100vh;background:#f3f5f7;color:#17212b;padding:24px;font:15px/1.5 Arial,sans-serif}
      .document-toolbar{max-width:850px;margin:0 auto 16px;display:flex;justify-content:space-between;align-items:center}
      .document-toolbar a{color:#324a5f;text-decoration:none}.document-toolbar button{border:0;border-radius:8px;padding:10px 18px;background:#1f5961;color:white;font:inherit;cursor:pointer}.period-picker{display:flex;align-items:center;gap:8px;margin-left:auto}.period-picker label{font-size:13px}.period-picker input{font:inherit;padding:7px;border:1px solid #b7c5ca;border-radius:6px}
      .document-paper{max-width:850px;min-height:700px;margin:auto;padding:clamp(24px,6vw,64px);background:white;box-shadow:0 8px 35px #18232d12}
      .document-header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #dce5e7;padding-bottom:24px}.document-header h1{margin:4px 0;font-size:32px}.document-header p{margin:2px 0;color:#566773}.document-eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:bold;color:#1f5961!important}.document-meta{text-align:right;text-transform:capitalize}.document-meta span{display:block;color:#566773;margin-top:6px}
      .document-parties{display:flex;flex-wrap:wrap;gap:48px;padding:25px 0}.document-parties section{min-width:150px;max-width:260px}.document-parties h2,.document-terms h2{margin:0 0 8px;text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:#61727e}.document-parties p{margin:2px 0;overflow-wrap:anywhere}.document-summary{margin:8px 0 20px;color:#40525e}
      .document-lines{width:100%;border-collapse:collapse;margin:16px 0 24px}.document-lines th,.document-lines td{padding:12px 8px;border-bottom:1px solid #e6ebed;text-align:left}.document-lines th{font-size:12px;text-transform:uppercase;color:#61727e}.document-lines .money{text-align:right;white-space:nowrap}
      .document-totals{width:min(100%,350px);margin:20px 0 24px auto}.document-totals div{display:flex;justify-content:space-between;gap:24px;padding:7px 0;border-bottom:1px solid #e6ebed}.document-totals div:last-child{font-weight:bold;font-size:17px;border-bottom:2px solid #17212b}.document-totals dt,.document-totals dd{margin:0}.document-terms{margin-top:40px;white-space:pre-wrap;color:#40525e}.document-paper footer{margin-top:50px;padding-top:14px;border-top:1px solid #e6ebed;color:#71808a;font-size:13px}
      @media(max-width:600px){.document-shell{padding:12px}.document-header{flex-direction:column}.document-meta{text-align:left}.document-lines{font-size:13px}.document-lines th,.document-lines td{padding:9px 4px}.document-parties{gap:20px}.document-paper{min-height:0}}
      @media print{.document-shell{padding:0;background:white}.document-toolbar{display:none}.document-paper{max-width:none;min-height:0;padding:0;box-shadow:none}.document-header,.document-parties,.document-summary,.document-lines,.document-totals,.document-terms{break-inside:avoid}@page{margin:18mm}}
    `}</style>
  </main>;
}
