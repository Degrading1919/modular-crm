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

  async function run(id: string, action: "verify" | "primary" | "remove") {
    setBusy(`${id}:${action}`);
    setError("");
    setNotice("");
    try {
      if (action === "remove") await api(`${ENDPOINT}/${encodeURIComponent(id)}`, { method: "DELETE" });
      else await api<DomainResult>(`${ENDPOINT}/${encodeURIComponent(id)}/${action}`, body({}));
      setNotice(action === "remove" ? "Domain removed. Your website uses its platform address when the removed domain was primary." : action === "primary" ? "Primary website address updated." : "Domain verified in local demo mode.");
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
      setNotice("Domain added. Add the DNS record below to prove you control it.");
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
      <p className="subtle">Use your own domain or keep the address included with your website. Your hosting provider will handle secure connections when your domain is live.</p>
    </div>
    {error && <Notice text={error} kind="error"/>}
    {notice && <Notice text={notice} kind="success"/>}

    {loading ? <Loading label="Loading website addresses…"/> : <>
      {platformDomain && <div className="card card-pad">
        <div className="card-heading"><div><h3>Included website address</h3><p className="subtle">{platformDomain.hostname}</p></div><Badge status={platformDomain.isPrimary ? "primary" : "available"}/></div>
        {!platformDomain.isPrimary && <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void run(platformDomain.id, "primary")}>Use included address</button>}
      </div>}

      <div className="card card-pad">
        <h3>Connect a custom domain</h3>
        <p className="subtle">Enter a domain you already own, such as www.yourbusiness.com. We’ll show the DNS record needed to verify it.</p>
        <form className="inline-actions" onSubmit={(event) => void addDomain(event)}>
          <label className="sr-only" htmlFor="custom-website-hostname">Domain name</label>
          <input id="custom-website-hostname" className="input" autoComplete="url" inputMode="url" placeholder="www.yourbusiness.com" value={hostname} onChange={(event) => setHostname(event.target.value)} required maxLength={253}/>
          <button className="btn btn-primary" type="submit" disabled={Boolean(busy) || !hostname.trim()}>{busy === "add" ? "Adding…" : "Add domain"}</button>
        </form>
      </div>

      {domains.length === 0 ? <Empty title="No custom domains yet" description="Add a domain above whenever you’re ready. Your included website address will keep working."/> : <div className="stack">
        {domains.map((domain) => <article className="card card-pad" key={domain.id}>
          <div className="card-heading"><div><h3>{domain.hostname}</h3><p className="subtle">{domain.isPrimary ? "Primary website address" : "Custom domain"}</p></div><Badge status={domain.isPrimary ? "primary" : domain.verificationStatus}/></div>
          {domain.verificationStatus !== "verified" && domain.dnsChallenge && <div className="stack" style={{ marginTop: 14 }}>
            <p>Add this DNS record wherever you manage your domain:</p>
            <dl className="detail-list"><dt>Record type</dt><dd>{domain.dnsChallenge.recordType}</dd><dt>Name</dt><dd><code>{domain.dnsChallenge.recordName}</code></dd><dt>Value</dt><dd><code>{domain.dnsChallenge.recordValue}</code></dd></dl>
            {simulatedVerificationAvailable
              ? <p className="subtle">Local demo mode can simulate DNS verification for this test domain.</p>
              : <p className="subtle">After DNS is in place, your hosting provider can verify the domain. External DNS verification is not simulated in this environment.</p>}
          </div>}
          <div className="inline-actions" style={{ marginTop: 16 }}>
            {domain.verificationStatus !== "verified" && simulatedVerificationAvailable && <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void run(domain.id, "verify")}>{busy === `${domain.id}:verify` ? "Checking…" : "Simulate verification (local)"}</button>}
            {domain.verificationStatus === "verified" && !domain.isPrimary && <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void run(domain.id, "primary")}>{busy === `${domain.id}:primary` ? "Updating…" : "Make primary"}</button>}
            <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void run(domain.id, "remove")}>{busy === `${domain.id}:remove` ? "Removing…" : "Remove domain"}</button>
          </div>
        </article>)}
      </div>}
    </>}
  </section>;
}
