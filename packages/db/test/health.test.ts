import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { checkDatabaseReady, migrationsApplied, migrationReadinessQuery } from "../src/health.ts";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
}, 120_000);
afterAll(async () => { await db?.close(); });

it("uses a real PostgreSQL round-trip and rejects a partially migrated database", async () => {
  // One isolated client at a time: this is not the concurrent PGlite transport harness.
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 3 });
  await server.start();
  const url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
  try {
    expect(await checkDatabaseReady(url)).toBe(true);
    await db.exec("BEGIN");
    try {
      await db.exec("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = (SELECT min(created_at) FROM drizzle.__drizzle_migrations)");
      expect(await checkDatabaseReady(url)).toBe(false);
    } finally { await db.exec("ROLLBACK"); }
  } finally { await server.stop(); }
});

it("checks every applied migration using the real migration ledger", async () => {
  const { rows } = await db.query<{ created_at: number }>(migrationReadinessQuery);
  expect(migrationsApplied(rows)).toBe(true);
  expect(migrationsApplied(rows.slice(1))).toBe(false);
  expect(migrationsApplied(rows.slice(0, -1))).toBe(false);
  expect(migrationsApplied([])).toBe(false);
});

it("returns unavailable for missing configuration and an unreachable database", async () => {
  expect(await checkDatabaseReady(undefined)).toBe(false);
  expect(await checkDatabaseReady("postgresql://%")).toBe(false);
  // Reserve then release an OS-selected port so no running user database is involved.
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  expect(await checkDatabaseReady(`postgresql://health@127.0.0.1:${address.port}/unreachable`)).toBe(false);
});

it("bounds an unresponsive database handshake and closes its socket", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  try {
    expect(await checkDatabaseReady(`postgresql://health@127.0.0.1:${address.port}/unresponsive`)).toBe(false);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 3_000);
