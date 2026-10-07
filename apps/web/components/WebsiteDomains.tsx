"use client";

import { useEffect, useState } from "react";
import { api, body } from "./api";
import { Badge, Empty, Loading, Notice } from "./ui";

type DnsChallenge = { recordType: "TXT"; recordName: string; recordValue: string } | null;
type WebsiteDomain = {
  id: string;
  hostname: string;
  domainType: "platform" | "custom";
  verificationStatus: string;
  isPrimary: boolean;
  verifiedAt: string | null;
  dnsChallenge: DnsChallenge;
  routingRecord: { recordType: string; recordName: string; recordValue: string } | null;
  certificateChallenge: DnsChallenge;
  state: string; problem: string | null; checkedAt: string | null;
};
type DomainList = { items: WebsiteDomain[]; platformDomain: WebsiteDomain | null; simulatedVerificationAvailable: boolean };
type DomainResult = { item: WebsiteDomain };

const ENDPOINT = "/website/domains";

/** Standalone owner setup surface for connecting and selecting a business website hostname. */
export default function WebsiteDomains() {
  const [domains, setDomains] = useState<WebsiteDomain[]>([]);
  const [platformDomain, setPlatformDomain] = useState<WebsiteDomain | null>(null);
  const [simulatedVerificationAvailable, setSimulatedVerificationAvailable] = useState(false);
  const [hostname, setHostname] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<DomainList>(ENDPOINT).then((result) => {
      if (!active) return;
      setDomains(result.items ?? []);
      setPlatformDomain(result.platformDomain ?? null);
      setSimulatedVerificationAvailable(result.simulatedVerificationAvailable === true);
      setError("");
    }).catch((issue: Error) => { if (active) setError(issue.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  async function run(id: string, action: "verify" | "primary" | "remove" | "mock-dns") {
    setBusy(`${id}:${action}`);
    setError("");
    setNotice("");
    try {
      if (action === "remove") await api(`${ENDPOINT}/${encodeURIComponent(id)}`, { method: "DELETE" });
      else await api<DomainResult>(`${ENDPOINT}/${encodeURIComponent(id)}/${action}`, body(action === "mock-dns" ? { ownership: "valid", routing: "valid", certificate: "ready" } : {}));
      setNotice(action === "remove" ? "Domain removed. Your website uses its platform address when the removed domain was primary." : action === "primary" ? "Primary website address updated." : action === "mock-dns" ? "Local test records added. Choose Check now to verify them." : "Domain check finished. See its status below.");
      setRefresh((value) => value + 1);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "We couldn’t update that domain.");
    } finally {
      setBusy("");
    }
  }

  async function addDomain(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("add");
    setError("");
    setNotice("");
    try {
      await api<DomainResult>(ENDPOINT, body({ hostname }));
      setHostname("");
      setNotice("Domain added. Add the records below, then choose Check now.");
      setRefresh((value) => value + 1);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "We couldn’t add that domain.");
    } finally {
      setBusy("");
    }
  }

  return <section className="stack" aria-labelledby="website-domains-title">
    <div>
      <h2 id="website-domains-title">Website address</h2>
      <p className="subtle">Use your own domain or keep the included address. We set up and renew your secure connection automatically after your records are verified.</p>
    </div>
    {error && <Notice text={error} kind="error"/>}
    {notice && <Notice text={notice} kind="success"/>}

    {loading ? <Loading label="Loading website addresses…"/> : <>
      {platformDomain && <div className="card card-pad">
        <div className="card-heading"><div><h3>Included website address</h3><p className="subtle">{platformDomain.hostname}</p></div><Badge status={platformDomain.isPrimary ? "primary" : "available"}/></div>
        {!platformDomain.isPrimary && <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void run(platformDomain.id, "primary")}>Use included address</button>}
      </div>}

      <div className="card card-pad">
        <h3>Use my own domain</h3>
        <p className="subtle">Enter a domain you own, such as www.yourbusiness.com. We’ll show exactly what to add where you bought it. Connecting www is usually simplest. Connecting the root address needs ALIAS, ANAME or CNAME flattening support; never add a guessed IP address.</p>
        <form className="inline-actions" onSubmit={(event) => void addDomain(event)}>
          <label className="sr-only" htmlFor="custom-website-hostname">Domain name</label>
          <input id="custom-website-hostname" className="input" autoComplete="url" inputMode="url" placeholder="www.yourbusiness.com" value={hostname} onChange={(event) => setHostname(event.target.value)} required maxLength={253}/>
          <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !hostname.trim()}>{busy === "add" ? "Adding…" : "Add domain"}</button>
        </form>
      </div>

      {domains.length === 0 ? <Empty title="No custom domains yet" description="Add a domain above whenever you’re ready. Your included website address will keep working."/> : <div className="stack">
        {domains.map((domain) => <article className="card card-pad" key={domain.id}>
          <div className="card-heading"><div><h3>{domain.hostname}</h3><p className="subtle">{domain.isPrimary ? "Primary website address" : "Custom domain"}</p></div>{domain.isPrimary && <Badge status="primary"/>}</div>
          <p role="status" aria-label="Domain setup status">{{ waiting_dns: "Waiting for DNS", verified: "Verified", securing: "Secure connection being set up", live: "Live", needs_attention: "Needs attention", removing: "Removing secure connection" }[domain.state] ?? "Waiting for DNS"}</p>
          {domain.problem && <Notice kind="info" text={domain.problem}/>}
          {domain.checkedAt && <p className="subtle">Last checked: {new Date(domain.checkedAt).toLocaleString()}. We keep checking automatically.</p>}
          {domain.dnsChallenge && domain.state !== "removing" && <div className="stack" style={{ marginTop: 14 }}>
            <p>Add these records where you manage your domain. Keep them in place while using this address.</p>
            <p className="subtle">GoDaddy and Namecheap call the name field “Host” or “Name”. Cloudflare calls it “Name”: choose DNS only, not Proxied. Route 53 calls it “Record name”. If your provider adds your domain automatically, enter just the part before your domain; use @ for the root.</p>
            {[domain.dnsChallenge, domain.routingRecord, domain.certificateChallenge].filter(record => !!record).map((record, index) => <div key={record.recordName} className="card card-pad">
              <h4>{index === 0 ? "Prove you own this address" : index === 1 ? "Point your website here" : "Allow the secure connection"}</h4>
              <dl className="detail-list"><dt>Record type</dt><dd>{record.recordType}</dd><dt>Name / Host</dt><dd><code>{record.recordName}</code> <button type="button" className="btn btn-secondary btn-sm" aria-label={`Copy ${index + 1} record name`} onClick={() => void navigator.clipboard.writeText(record.recordName).then(() => setNotice("Record name copied.")).catch(() => setError("Select and copy the record name above."))}>Copy name</button></dd><dt>Value / Target</dt><dd><code>{record.recordValue}</code> <button type="button" className="btn btn-secondary btn-sm" aria-label={`Copy ${index + 1} record value`} onClick={() => void navigator.clipboard.writeText(record.recordValue).then(() => setNotice("Record value copied.")).catch(() => setError("Select and copy the record value above."))}>Copy value</button></dd></dl>
            </div>)}
            <p className="subtle">Leave email records unchanged. Changes may take a few minutes or up to 48 hours to appear. If your provider cannot point the root address here, connect www and use its root-to-www forwarding option.</p>
            {simulatedVerificationAvailable
              ? <p className="subtle">Local demo mode can simulate DNS verification for this test domain.</p>
              : <p className="subtle">Choose Check now after saving the records. We’ll verify ownership, the website address and the secure connection separately.</p>}
          </div>}
          <div className="inline-actions" style={{ marginTop: 16 }}>
            {domain.state !== "removing" && <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void run(domain.id, "verify")}>{busy === `${domain.id}:verify` ? "Checking…" : "Check now"}</button>}
            {domain.state === "waiting_dns" && simulatedVerificationAvailable && <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void run(domain.id, "mock-dns")}>Add test DNS records (local)</button>}
            {domain.state === "live" && !domain.isPrimary && <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void run(domain.id, "primary")}>{busy === `${domain.id}:primary` ? "Updating…" : "Make primary"}</button>}
            {domain.state === "live" && <a className="btn btn-secondary btn-sm" href={`https://${domain.hostname}`} target="_blank" rel="noreferrer">Visit website</a>}
            {domain.state !== "removing" && <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void run(domain.id, "remove")}>{busy === `${domain.id}:remove` ? "Removing…" : "Remove domain"}</button>}
          </div>
        </article>)}
      </div>}
    </>}
  </section>;
}
