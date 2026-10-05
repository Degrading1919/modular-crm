import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { PgBoss } from "pg-boss";
import { checkDatabaseReady } from "@modular-crm/db";
import { QUEUES } from "./queues.js";

/** Inspect pg-boss's actual polling workers, not merely a successful startup flag. */
export function jobLoopRunning(boss: Pick<PgBoss, "getWipData">): boolean {
  const workers = boss.getWipData();
  return Object.values(QUEUES).every((name) => workers.some((worker) => worker.name === name && worker.state === "active" && worker.lastFetchedOn !== null));
}

export async function startHealthServer(input: {
  port: number; connectionString: string; isRunning: () => boolean;
  checkReady?: typeof checkDatabaseReady; host?: string;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const reply = (status: number, body: string) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ status: body }));
    };
    if (request.method !== "GET") { reply(405, "unavailable"); return; }
    if (request.url === "/api/health/live") { reply(200, "ok"); return; }
    if (request.url !== "/api/health/ready") { reply(404, "unavailable"); return; }
    if (!input.isRunning()) { reply(503, "unavailable"); return; }
    void (input.checkReady ?? checkDatabaseReady)(input.connectionString).then((ready) => {
      const available = ready && input.isRunning();
      reply(available ? 200 : 503, available ? "ok" : "unavailable");
    }).catch(() => reply(503, "unavailable"));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host ?? "0.0.0.0", () => { server.removeListener("error", reject); resolve(); });
  });
  return { port: (server.address() as AddressInfo).port, stop: () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  }) };
}
