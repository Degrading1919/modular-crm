import { PgBoss } from "pg-boss";
import { migrateDatabase } from "../../../packages/db/src/migrate.ts";
import { registerWorkerQueues } from "./queues.js";

// One-shot release operation, not imported by long-lived worker/web entry points.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for migrations");
await migrateDatabase(connectionString);
const boss = new PgBoss({ connectionString, schedule: false, supervise: false });
boss.on("error", () => { process.exitCode = 1; console.error("Queue schema initialization failed"); });
try {
  await boss.start();
  await registerWorkerQueues(boss);
  console.info("Application and queue migrations applied");
} finally { await boss.stop(); }
