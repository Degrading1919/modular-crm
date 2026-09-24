import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";

type SnapshotTable = {
  name: string;
  columns: Record<string, unknown>;
  indexes: Record<string, unknown>;
  foreignKeys: Record<string, unknown>;
  checkConstraints: Record<string, unknown>;
};
type Snapshot = { tables: Record<string, SnapshotTable> };
type MigrationJournal = { entries: { idx: number; tag: string }[] };

export async function checkDatabaseDrift(connectionString: string): Promise<string[]> {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  const journal = JSON.parse(await readFile(fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url)), "utf8")) as MigrationJournal;
  const latestMigration = journal.entries.at(-1);
  if (!latestMigration) throw new Error("The Drizzle migration journal is empty");
  const snapshot = JSON.parse(await readFile(fileURLToPath(new URL(`../drizzle/meta/${String(latestMigration.idx).padStart(4, "0")}_snapshot.json`, import.meta.url)), "utf8")) as Snapshot;
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const migrations = readMigrationFiles({ migrationsFolder });
    const columnResult = await pool.query<{ table_name: string; column_name: string }>(`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
    const indexResult = await pool.query<{ tablename: string; indexname: string }>(`
      SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'`);
    const constraintResult = await pool.query<{ table_name: string; constraint_name: string }>(`
      SELECT rel.relname AS table_name, con.conname AS constraint_name
      FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = 'public'`);
    const columns = new Map<string, Set<string>>();
    const indexes = new Map<string, Set<string>>();
    const constraints = new Map<string, Set<string>>();
    for (const row of columnResult.rows) {
      if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
      columns.get(row.table_name)!.add(row.column_name);
    }
    for (const row of indexResult.rows) {
      if (!indexes.has(row.tablename)) indexes.set(row.tablename, new Set());
      indexes.get(row.tablename)!.add(row.indexname);
    }
    for (const row of constraintResult.rows) {
      if (!constraints.has(row.table_name)) constraints.set(row.table_name, new Set());
      constraints.get(row.table_name)!.add(row.constraint_name);
    }

    const issues: string[] = [];
    const migrationResult = await pool.query<{ hash: string; created_at: string }>(
      `SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at`,
    );
    for (const migration of migrations) {
      const applied = migrationResult.rows.find((row) => Number(row.created_at) === migration.folderMillis);
      if (!applied) issues.push(`unapplied migration: ${migration.folderMillis}`);
      else if (applied.hash !== migration.hash) issues.push(`migration hash mismatch: ${migration.folderMillis}`);
    }
    for (const table of Object.values(snapshot.tables)) {
      const liveColumns = columns.get(table.name);
      if (!liveColumns) {
        issues.push(`missing table: ${table.name}`);
        continue;
      }
      for (const name of Object.keys(table.columns ?? {})) {
        if (!liveColumns.has(name)) issues.push(`missing column: ${table.name}.${name}`);
      }
      for (const name of liveColumns) {
        if (!(name in table.columns)) issues.push(`extra column: ${table.name}.${name}`);
      }
      for (const name of Object.keys(table.indexes ?? {})) {
        if (!indexes.get(table.name)?.has(name)) issues.push(`missing index: ${table.name}.${name}`);
      }
      for (const name of Object.keys(table.foreignKeys ?? {})) {
        // PostgreSQL truncates identifiers to 63 bytes. All generated names here are ASCII.
        if (!constraints.get(table.name)?.has(name.slice(0, 63))) issues.push(`missing foreign key: ${table.name}.${name}`);
      }
      for (const name of Object.keys(table.checkConstraints ?? {})) {
        if (!constraints.get(table.name)?.has(name.slice(0, 63))) issues.push(`missing check: ${table.name}.${name}`);
      }
    }
    return issues;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to check schema drift");
  const issues = await checkDatabaseDrift(connectionString);
  if (issues.length) {
    console.error(`Database schema drift (${issues.length}):\n${issues.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.info("Database schema matches the committed Drizzle snapshot");
  }
}
