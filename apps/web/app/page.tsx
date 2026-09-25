import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import PublicSite from "../components/PublicSite";
import { isLocalApplicationHostname, normalizeRequestHostname, resolvePublishedSiteForHost } from "../lib/public-site-host";

export const dynamic = "force-dynamic";

export default async function Home() {
  const host = normalizeRequestHostname((await headers()).get("host"));
  if (isLocalApplicationHostname(host)) redirect("/site/happy-yards");

  const site = await resolvePublishedSiteForHost(host);
  if (!site) notFound();
  return <PublicSite slug={site.slug} />;
}
