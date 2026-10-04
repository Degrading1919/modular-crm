import { afterEach, describe, expect, it } from "vitest";
import type { Socket } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { releaseDisconnectedSlots } from "../src/pglite-socket-slots.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

async function startServer(port: number) {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port, maxConnections: 3 });
  await server.start();
  releaseDisconnectedSlots(server);
  cleanup.push(async () => { await server.stop(); await db.close(); });
  return { server, url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres` };
}

/** Simulates a client process that is killed mid-session: its socket ends with a reset, not a clean close. */
async function connectThenReset(url: string) {
  const client = new pg.Client({ connectionString: url });
  client.on("error", () => {});
  await client.connect();
  await client.query("select 1");
  (client as unknown as { connection: { stream: Socket } }).connection.stream.resetAndDestroy();
}

async function queryOnce(url: string) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
  client.on("error", () => {});
  try {
    await client.connect();
    return (await client.query<{ value: number }>("select 1 as value")).rows[0]?.value;
  } finally {
    await client.end().catch(() => {});
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

describe("local PGlite connection slots", () => {
  it("accepts new clients after earlier clients disconnected abruptly", async () => {
    const { server, url } = await startServer(55432);
    for (let i = 0; i < 5; i++) await connectThenReset(url);
    await settle();
    await expect(queryOnce(url)).resolves.toBe(1);
    await settle();
    expect(server.getStats().activeConnections).toBe(0);
  });
});
