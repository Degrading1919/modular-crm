import { afterEach, beforeEach, expect, it } from "vitest";
import { createConnection } from "node:net";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { isolatePgliteProtocol } from "../src/pglite-protocol.ts";
import pg from "pg";

const cleanup: (() => Promise<void>)[] = [];
let db: PGlite;
// WASM startup is fixture setup, not part of the timed wire interleaving.
beforeEach(async () => { db = await PGlite.create(); });
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });
const int = (value: number, width = 4) => { const result = Buffer.alloc(width); if (width === 4) result.writeInt32BE(value); else result.writeInt16BE(value); return result; };
const string = (value: string) => Buffer.from(`${value}\0`);
const packet = (type: string, ...parts: Buffer[]) => { const payload = Buffer.concat(parts); return Buffer.concat([Buffer.from(type), int(payload.length + 4), payload]); };
const parse = (query: string) => packet("P", string(""), string(query), int(0, 2));
const bind = (...values: string[]) => packet("B", string(""), string(""), int(0, 2), int(values.length, 2), ...values.flatMap((value) => [int(Buffer.byteLength(value)), Buffer.from(value)]), int(0, 2));
const finish = (...values: string[]) => Buffer.concat([bind(...values), packet("D", Buffer.from("P"), string("")), packet("E", string(""), int(0)), packet("S")]);

async function wire(address: string) {
  const [host, port] = address.split(":");
  const socket = createConnection({ host, port: Number(port) });
  await once(socket, "connect");
  let buffered = Buffer.alloc(0);
  const received: { type: string; payload: Buffer }[] = [];
  const waiters: (() => void)[] = [];
  socket.on("data", (data) => {
    buffered = Buffer.concat([buffered, data]);
    while (buffered.length >= 5 && buffered.length >= buffered.readInt32BE(1) + 1) {
      const length = buffered.readInt32BE(1) + 1;
      received.push({ type: buffered.toString("utf8", 0, 1), payload: buffered.subarray(5, length) });
      buffered = buffered.subarray(length);
    }
    for (const waiter of waiters.splice(0)) waiter();
  });
  const waitFor = async (type: string, count = 1) => {
    while (received.filter((message) => message.type === type).length < count) await new Promise<void>((resolve) => waiters.push(resolve));
  };
  const startup = Buffer.concat([int(196608), string("user"), string("postgres"), string("database"), string("postgres"), Buffer.from([0])]);
  socket.write(Buffer.concat([int(startup.length + 4), startup]));
  await waitFor("Z");
  cleanup.push(async () => { const closed = once(socket, "close"); socket.destroy(); await closed; });
  return { socket, received, waitFor };
}

it("keeps another client's Parse from replacing a technician auth query before Bind/Execute/Sync", async () => {
  const server = new PGLiteSocketServer({ db, port: 0, maxConnections: 3 });
  const protocol = isolatePgliteProtocol(server);
  await server.start();
  cleanup.push(async () => { await server.stop(); await protocol.settled(); await db.close(); });
  const first = await wire(server.getServerConn()), second = await wire(server.getServerConn());
  first.socket.write(parse("select $1::text as token"));
  await first.waitFor("1");
  // Gate on actual arrival at the transport, not a sleep or probabilistic load.
  const queue = (server as unknown as { queryQueue: { enqueue: (id: number, message: Uint8Array, onData: (data: Uint8Array) => void) => Promise<number> } }).queryQueue;
  const original = queue.enqueue.bind(queue);
  let entered!: () => void;
  const arrived = new Promise<void>((resolve) => { entered = resolve; });
  queue.enqueue = (id, message, onData) => { const result = original(id, message, onData); if (message[0] === 80) entered(); return result; };
  second.socket.write(Buffer.concat([parse("select $1::int + $2::int as value"), finish("20", "22")]));
  await arrived;
  first.socket.write(finish("technician-session"));
  await Promise.all([first.waitFor("Z", 2), second.waitFor("Z", 2)]);
  expect(first.received.filter((message) => message.type === "E").map((message) => message.payload.toString())).toEqual([]);
  expect(second.received.filter((message) => message.type === "E").map((message) => message.payload.toString())).toEqual([]);
  expect(first.received.find((message) => message.type === "D")?.payload.subarray(6).toString()).toBe("technician-session");
  expect(second.received.find((message) => message.type === "D")?.payload.subarray(6).toString()).toBe("42");
});

it("retains transaction ownership, recovers errors, and rolls back a disconnected owner before releasing unrelated clients", async () => {
  const server = new PGLiteSocketServer({ db, port: 0, maxConnections: 4 });
  const protocol = isolatePgliteProtocol(server);
  await server.start();
  cleanup.push(async () => { await server.stop(); await protocol.settled(); await db.close(); });
  const first = new pg.Client({ connectionString: `postgresql://postgres:postgres@${server.getServerConn()}/postgres` });
  const second = new pg.Client({ connectionString: `postgresql://postgres:postgres@${server.getServerConn()}/postgres` });
  first.on("error", () => {}); second.on("error", () => {});
  await first.connect(); await second.connect();
  cleanup.push(async () => { await first.end().catch(() => {}); await second.end(); });
  await first.query("create table protocol_effects (value text)");
  await first.query("begin");
  await first.query("insert into protocol_effects values ($1)", ["must rollback"]);
  const independent = second.query("select $1::text as value", ["other client"]);
  await expect(first.query("select missing_column from protocol_effects")).rejects.toMatchObject({ code: "42703" });
  await first.query("rollback");
  expect((await independent).rows).toEqual([{ value: "other client" }]);
  await first.query("begin");
  await first.query("insert into protocol_effects values ($1)", ["lost connection"]);
  const waiting = second.query("select count(*)::int as count from protocol_effects");
  await first.end();
  expect((await waiting).rows).toEqual([{ count: 0 }]);
  expect((await second.query("select $1::text as value", ["still authenticated"])).rows).toEqual([{ value: "still authenticated" }]);
});
