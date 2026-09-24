import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import DocumentViewer from "./document-viewer";
import { resolveActor } from "../../../../../lib/api/actor";
import { getDocument } from "../../../../../lib/api/documents";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ period?: string | string[] }> }) {
  const requestHeaders = await headers();
  const actor = await resolveActor(new Request("http://localhost/app/documents", { headers: requestHeaders }));
  if (!actor) redirect("/login");
  const { kind, id } = await params;
  const query = await searchParams;
  const period = typeof query.period === "string" ? query.period : undefined;
  let document: Awaited<ReturnType<typeof getDocument>>;
  try {
    document = await getDocument(actor, kind, id, { period });
  } catch {
    notFound();
  }
  return <DocumentViewer document={document} backHref="/app" routePath={`/app/documents/${kind}/${id}`} />;
}
