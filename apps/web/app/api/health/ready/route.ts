import { checkDatabaseReady } from "@modular-crm/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ready = await checkDatabaseReady(process.env.DATABASE_URL);
  return Response.json({ status: ready ? "ok" : "unavailable" }, {
    status: ready ? 200 : 503, headers: { "cache-control": "no-store" },
  });
}
