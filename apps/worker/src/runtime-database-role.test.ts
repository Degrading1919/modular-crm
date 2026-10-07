import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { grantRuntimeDatabaseRole, configureRuntimeDatabaseRole } from "./runtime-database-role.js";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
it("creates a constrained runtime login with safely quoted passwords after schemas exist", async () => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] }));
  await grantRuntimeDatabaseRole({ query }, "crm_runtime", "a".repeat(32) + "'secret");
  const statements = query.mock.calls.map((call) => String(call[0]));
  expect(statements[1]).toContain("''secret");
  expect(statements[1]).toContain("NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION");
  expect(statements).toContain('GRANT CREATE ON SCHEMA pgboss TO "crm_runtime"');
  expect(statements.some((sql) => sql.includes("CREATE ON SCHEMA public") || sql.includes("GRANT ALL"))).toBe(false);
  expect(statements.filter((sql) => sql.startsWith("ALTER DEFAULT PRIVILEGES"))).toHaveLength(6);
});

describe("runtime PostgreSQL permissions", () => {
  let db: PGlite;
  // Match integration fixture lifecycle without overriding limits or reordering tests.
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE SCHEMA pgboss; CREATE SCHEMA drizzle; CREATE TABLE public.runtime_probe(id serial PRIMARY KEY); CREATE TABLE drizzle.__drizzle_migrations(id int); CREATE TABLE pgboss.queue(name text)");
  });
  afterAll(async () => { await db?.close(); });
  it("enforces CRUD-only public access and read-only migration readiness in PostgreSQL", async () => {
    await grantRuntimeDatabaseRole({ query: (sql, values) => db.query(sql, values) }, "crm_runtime", "x".repeat(40));
    const { rows } = await db.query<{ admin: boolean; crud: boolean; journal_read: boolean; journal_write: boolean; public_create: boolean }>(`SELECT
      (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication FROM pg_roles WHERE rolname='crm_runtime') AS admin,
      has_table_privilege('crm_runtime','public.runtime_probe','SELECT,INSERT,UPDATE,DELETE') AS crud,
      has_table_privilege('crm_runtime','drizzle.__drizzle_migrations','SELECT') AS journal_read,
      has_table_privilege('crm_runtime','drizzle.__drizzle_migrations','INSERT') AS journal_write,
      has_schema_privilege('crm_runtime','public','CREATE') AS public_create`);
    expect(rows[0]).toEqual({ admin: false, crud: true, journal_read: true, journal_write: false, public_create: false });
    await db.exec("CREATE TABLE public.next_migration(id int); SET ROLE crm_runtime; INSERT INTO public.next_migration VALUES(1)");
    await expect(db.exec("INSERT INTO drizzle.__drizzle_migrations VALUES(1)")).rejects.toThrow();
    await expect(db.exec("CREATE TABLE public.forbidden(id int)")).rejects.toThrow();
  });
});
it("updates an existing restored identity without recreating it", async () => {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [1] }));
  await grantRuntimeDatabaseRole({ query }, "crm_runtime", "b".repeat(40));
  expect(query.mock.calls.map((call) => String(call[0])).some((sql) => sql.startsWith("ALTER ROLE"))).toBe(true);
});
it("fails closed and never leaks a credential on grant errors", async () => {
  const password = "s".repeat(40);
  await expect(grantRuntimeDatabaseRole({ query: async () => { throw new Error(password); } }, "crm_runtime", password)).rejects.toThrow("permissions could not be applied");
  await expect(grantRuntimeDatabaseRole({ query: async () => ({ rows: [] }) }, 'bad"name', password)).rejects.toThrow("Invalid");
  await expect(configureRuntimeDatabaseRole("unused", { DB_RUNTIME_PASSWORD: password })).rejects.toThrow("Complete");
  await expect(configureRuntimeDatabaseRole("unused", {})).resolves.toBeUndefined();
});
