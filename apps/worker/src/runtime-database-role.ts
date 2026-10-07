import { Pool } from "pg";

type RoleWriter = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
/** Release-only PostgreSQL grants; business processes never receive the database administrator password. */
export async function grantRuntimeDatabaseRole(writer: RoleWriter, username: string, password: string) {
  if (!/^crm_[a-z0-9_]{1,40}$/.test(username) || password.length < 32 || /[\u0000\r\n]/.test(password)) throw new Error("Invalid runtime database identity configuration");
  const role = `"${username}"`;
  const literal = `'${password.replaceAll("'", "''")}'`;
  try {
    const existing = await writer.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [username]);
    if (!existing.rows.length) await writer.query(`CREATE ROLE ${role} LOGIN PASSWORD ${literal} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
    else await writer.query(`ALTER ROLE ${role} LOGIN PASSWORD ${literal} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
    // Readiness verifies the full journal, but runtime cannot write migration history.
    await writer.query(`GRANT USAGE ON SCHEMA drizzle TO ${role}`);
    await writer.query(`GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO ${role}`);
    for (const schema of ["public", "pgboss"]) {
      await writer.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      // pg-boss can manage queue tables within its dedicated schema, never public schema or database administration.
      if (schema === "pgboss") await writer.query(`GRANT CREATE ON SCHEMA pgboss TO ${role}`);
      await writer.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
      await writer.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
      await writer.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${role}`);
      await writer.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
      await writer.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`);
      await writer.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT EXECUTE ON FUNCTIONS TO ${role}`);
    }
  } catch { throw new Error("Runtime database permissions could not be applied"); }
}

export async function configureRuntimeDatabaseRole(connectionString: string, env: Record<string, string | undefined>) {
  if (!env.DB_RUNTIME_USERNAME && !env.DB_RUNTIME_PASSWORD) return; // Existing portable deployments unchanged.
  if (!env.DB_RUNTIME_USERNAME || !env.DB_RUNTIME_PASSWORD) throw new Error("Complete runtime database identity is required");
  const pool = new Pool({ connectionString, max: 1 });
  try { await grantRuntimeDatabaseRole(pool, env.DB_RUNTIME_USERNAME, env.DB_RUNTIME_PASSWORD); }
  finally { await pool.end(); }
}
