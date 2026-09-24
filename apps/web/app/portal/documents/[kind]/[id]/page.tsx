import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import DocumentViewer from "../../../../app/documents/[kind]/[id]/document-viewer";
import { resolveActor } from "../../../../../lib/api/actor";
import { getDocument } from "../../../../../lib/api/documents";

export const dynamic = "force-dynamic";

export default async function PortalDocumentPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ period?: string | string[] }> }) {
  const requestHeaders = await headers();
  const actor = await resolveActor(new Request("http://localhost/portal/documents", { headers: requestHeaders }));
  if (!actor) redirect("/login");
  if (actor.kind !== "customer") notFound();
  const { kind, id } = await params;
  const query = await searchParams;
  const period = typeof query.period === "string" ? query.period : undefined;
  let document: Awaited<ReturnType<typeof getDocument>>;
  try {
    document = await getDocument(actor, kind, id, { period });
  } catch {
    notFound();
  }
  return <DocumentViewer document={document} backHref="/portal" routePath={`/portal/documents/${kind}/${id}`} />;
}
