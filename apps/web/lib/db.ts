import { createDatabase } from "@modular-crm/db";

const globalForDb = globalThis as typeof globalThis & { modularDb?: ReturnType<typeof createDatabase> };

export function getDb() {
  if (!globalForDb.modularDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required. Copy .env.example to .env and run pnpm infra:up.");
    globalForDb.modularDb = createDatabase(url);
  }
  return globalForDb.modularDb;
}
