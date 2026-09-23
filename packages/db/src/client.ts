import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./schema/index.ts";

export type Database = NodePgDatabase<typeof schema>;
const pools = new WeakMap<Database, Pool>();

export function createDatabase(connectionString: string): Database {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  pools.set(db, pool);
  return db;
}

export async function closeDatabase(db: Database): Promise<void> {
  const pool = pools.get(db);
  if (pool) {
    pools.delete(db);
    await pool.end();
  }
}
