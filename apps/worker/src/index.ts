import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { PgBoss } from "pg-boss";
import { closeDatabase, createDatabase, type Database } from "@modular-crm/db";
import { isSecretEnvelope, openSecret } from "@modular-crm/domain";
import { createMockConnectorRegistry } from "@modular-crm/connectors";
import { enqueuePendingAutomationRuns, processAutomationRun } from "./automations-db.js";
import { processDomainEvent, publishPendingDomainEvents } from "./events-db.js";
import { enqueuePendingMessages, processOutboundMessage } from "./messages-db.js";
import { QUEUES, registerWorkerQueues, type AutomationRunJob, type DomainEventJob, type OutboundMessageJob, type RecurringGenerationJob, type WebhookDeliveryJob } from "./queues.js";
import { generateRecurringJobs } from "./recurring-db.js";
import { enqueuePendingWebhookDeliveries, processWebhookDelivery, type WebhookSecretResolver } from "./webhooks-db.js";

function log(event: string, fields: Record<string, unknown> = {}): void { console.log(JSON.stringify({ at: new Date().toISOString(), component: "worker", event, ...fields })); }

export function environmentSecretResolver(env: Record<string, string | undefined>): WebhookSecretResolver {
  let entries: Record<string, string> = {};
  if (env.WEBHOOK_SECRETS_JSON) {
    const parsed = JSON.parse(env.WEBHOOK_SECRETS_JSON) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("WEBHOOK_SECRETS_JSON must be a JSON object");
    entries = Object.fromEntries(Object.entries(parsed).filter((item): item is [string, string] => typeof item[1] === "string"));
  }
  return async (reference) => {
    if (entries[reference] !== undefined) return entries[reference];
    if (isSecretEnvelope(reference)) {
      const key = env.WEBHOOK_SECRET_ENCRYPTION_KEY;
      if (!key) throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY is required to decrypt webhook signing secrets");
      return openSecret(reference, key);
    }
    return reference === "local-test" ? env.WEBHOOK_TEST_SECRET : undefined;
  };
}

export async function registerWorkerHandlers(db: Database, boss: PgBoss, resolveSecret: WebhookSecretResolver): Promise<void> {
  const registry = createMockConnectorRegistry();
  await boss.work(QUEUES.publishOutbox, async () => {
    const [events, messages, automations, webhooks] = await Promise.all([
      publishPendingDomainEvents(db, boss), enqueuePendingMessages(db, boss),
      enqueuePendingAutomationRuns(db, boss), enqueuePendingWebhookDeliveries(db, boss),
    ]);
    if (events || messages || automations || webhooks) log("outbox.published", { events, messages, automations, webhooks });
  });
  await boss.work<RecurringGenerationJob>(QUEUES.recurringGeneration, async (jobs) => {
    for (const job of jobs) {
      const result = await generateRecurringJobs(db, { tenantId: job.data.tenantId, planId: job.data.planId, through: job.data.through });
      log("recurring.generated", { tenantId: job.data.tenantId ?? "all", ...result });
    }
  });
  await boss.work<DomainEventJob>(QUEUES.domainEvent, async (jobs) => {
    for (const job of jobs) await processDomainEvent(db, boss, job.data);
  });
  await boss.work<AutomationRunJob>(QUEUES.automationRun, async (jobs) => {
    for (const job of jobs) await processAutomationRun(db, boss, job.data);
  });
  await boss.work<OutboundMessageJob>(QUEUES.outboundMessage, async (jobs) => {
    for (const job of jobs) await processOutboundMessage(db, registry, job.data);
  });
  await boss.work<WebhookDeliveryJob>(QUEUES.webhookDelivery, async (jobs) => {
    for (const job of jobs) await processWebhookDelivery(db, boss, job.data, resolveSecret);
  });
}

export async function startWorker(env: Record<string, string | undefined> = process.env): Promise<{ stop: () => Promise<void>; boss: PgBoss; db: Database }> {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for the background worker");
  const db = createDatabase(connectionString);
  const boss = new PgBoss({ connectionString });
  boss.on("error", (error) => log("queue.error", { message: error.message }));
  try {
    await boss.start();
    await registerWorkerQueues(boss);
    await registerWorkerHandlers(db, boss, environmentSecretResolver(env));
    await boss.schedule(QUEUES.publishOutbox, "* * * * *", {}, { tz: "UTC" });
    await boss.schedule(QUEUES.recurringGeneration, "0 3 * * *", {}, { tz: "UTC" });
    await boss.send(QUEUES.publishOutbox, {});
    await boss.send(QUEUES.recurringGeneration, {});
    const outboxSweep = setInterval(() => {
      void boss.send(QUEUES.publishOutbox, {}).catch(() => log("outbox.enqueue_failed"));
    }, 15_000);
    log("started", { queues: Object.values(QUEUES) });
    return { boss, db, stop: async () => { clearInterval(outboxSweep); await boss.stop(); await closeDatabase(db); log("stopped"); } };
  } catch (error) {
    await boss.stop().catch(() => undefined);
    await closeDatabase(db);
    throw error;
  }
}

const calledAsEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (calledAsEntry) {
  startWorker().then(({ stop }) => {
    let stopping = false;
    const shutdown = () => { if (stopping) return; stopping = true; void stop().then(() => process.exit(0), (error) => { log("shutdown.error", { message: error instanceof Error ? error.message : "unknown" }); process.exit(1); }); };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch((error) => { log("startup.error", { message: error instanceof Error ? error.message : "unknown" }); process.exitCode = 1; });
}
