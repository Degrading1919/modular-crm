import { expect, it } from "vitest";
import type { PgBoss, WipData } from "pg-boss";
import { jobLoopRunning, startHealthServer } from "./health.js";
import { QUEUES } from "./queues.js";

it("requires every actual queue worker to be polling, including after offWork/stop", () => {
  const workers = Object.values(QUEUES).map((name) => ({ name, state: "active", lastFetchedOn: Date.now() })) as WipData[];
  const boss: Pick<PgBoss, "getWipData"> = { getWipData: () => workers };
  expect(jobLoopRunning(boss)).toBe(true);
  workers[0]!.state = "stopping";
  expect(jobLoopRunning(boss)).toBe(false);
  workers[0]!.state = "active";
  workers[0]!.lastFetchedOn = null;
  expect(jobLoopRunning(boss)).toBe(false);
  workers.shift();
  expect(jobLoopRunning(boss)).toBe(false);
});

it("serves generic unauthenticated liveness/readiness and stops cleanly", async () => {
  let running = false;
  let databaseReady = true;
  let probeCount = 0;
  const health = await startHealthServer({ port: 0, host: "127.0.0.1", connectionString: "private-db", isRunning: () => running,
    checkReady: async () => { probeCount++; return databaseReady; } });
  const get = (path: string) => fetch(`http://127.0.0.1:${health.port}${path}`);
  try {
    const live = await get("/api/health/live");
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });
    expect(probeCount).toBe(0);
    expect((await get("/api/health/ready")).status).toBe(503);
    expect(probeCount).toBe(0);
    running = true;
    expect((await get("/api/health/ready")).status).toBe(200);
    databaseReady = false;
    const unavailable = await get("/api/health/ready");
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ status: "unavailable" });
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    expect((await get("/unknown")).status).toBe(404);
    running = false;
    expect((await get("/api/health/live")).status).toBe(200);
    expect((await get("/api/health/ready")).status).toBe(503);
  } finally { await health.stop(); }
});

it("returns 503 over HTTP when PostgreSQL is unreachable", async () => {
  const health = await startHealthServer({ port: 0, host: "127.0.0.1", connectionString: "postgresql://health@127.0.0.1:1/unreachable", isRunning: () => true });
  try {
    const response = await fetch(`http://127.0.0.1:${health.port}/api/health/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  } finally { await health.stop(); }
});
