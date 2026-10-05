import { Client } from "pg";
import journal from "../drizzle/meta/_journal.json" with { type: "json" };

export const HEALTH_TIMEOUT_MS = 1_000;
export const migrationReadinessQuery = 'SELECT created_at FROM drizzle.__drizzle_migrations';

/** Require every migration shipped with this application, not just the latest row. */
export function migrationsApplied(rows: readonly { created_at: string | number }[]): boolean {
  const applied = new Set(rows.map((row) => Number(row.created_at)));
  return journal.entries.every((entry) => applied.has(entry.when));
}

/** Dedicated, bounded connection: no application-pool backlog or leaked query after timeout. */
export async function checkDatabaseReady(connectionString: string | undefined): Promise<boolean> {
  if (!connectionString) return false;
  let client: Client | undefined;
  try {
    client = new Client({ connectionString, connectionTimeoutMillis: HEALTH_TIMEOUT_MS,
      query_timeout: HEALTH_TIMEOUT_MS, statement_timeout: HEALTH_TIMEOUT_MS });
    client.on("error", () => undefined);
    await client.connect();
    const { rows } = await client.query<{ created_at: string }>(migrationReadinessQuery);
    return migrationsApplied(rows);
  } catch { return false; }
  finally { await client?.end().catch(() => undefined); }
}
