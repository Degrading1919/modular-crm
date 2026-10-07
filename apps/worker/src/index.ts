import { logJson } from "@modular-crm/config/observability";
import { observeJob } from "./observability.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { PgBoss } from "pg-boss";
import { readServerConfig, type ServerConfig } from "@modular-crm/config";
import { cleanupRateLimits, closeDatabase, createDatabase, type Database } from "@modular-crm/db";
import { isSecretEnvelope, openSecret } from "@modular-crm/domain";
import { createConnectorRegistry } from "@modular-crm/connectors";
import { enqueuePendingAutomationRuns, processAutomationRun } from "./automations-db.js";
import { processDomainEvent, publishPendingDomainEvents } from "./events-db.js";
import { jobLoopRunning, startHealthServer } from "./health.js";
import { sweepPlatformBilling } from "@modular-crm/db";
import { createPlatformBillingProvider } from "@modular-crm/connectors";
import { DEVELOPMENT_AUTH_SECRET } from "@modular-crm/config";
import { enqueuePendingMessages, processOutboundMessage } from "./messages-db.js";
import { QUEUES, registerWorkerQueues, type AutomationRunJob, type DomainEventJob, type OutboundMessageJob, type RecurringGenerationJob, type WebhookDeliveryJob } from "./queues.js";
import { generateRecurringJobs } from "./recurring-db.js";
import { enqueueInvoiceReminders } from "./invoice-reminders-db.js";
import { enqueuePendingWebhookDeliveries, processWebhookDelivery, type WebhookSecretResolver } from "./webhooks-db.js";

function log(event: string, fields: Record<string, unknown> = {}): void { logJson(event.endsWith("error") || event.endsWith("failed") ? "error" : "info", event, { component: "worker", ...fields }); }

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

export async function registerWorkerHandlers(db: Database, boss: PgBoss, resolveSecret: WebhookSecretResolver, config: ServerConfig = readServerConfig(process.env)): Promise<void> {
  await boss.work(QUEUES.publishOutbox, async (jobs) => {
    for (const job of jobs) await observeJob(QUEUES.publishOutbox, job.data, async () => {
      await cleanupRateLimits(db);
      await sweepPlatformBilling(db, config.platformBilling, { secret: process.env.BETTER_AUTH_SECRET ?? DEVELOPMENT_AUTH_SECRET, baseUrl: config.appBaseUrl });
      await enqueueInvoiceReminders(db);
      const [events, messages, automations, webhooks] = await Promise.all([
        publishPendingDomainEvents(db, boss), enqueuePendingMessages(db, boss),
        enqueuePendingAutomationRuns(db, boss), enqueuePendingWebhookDeliveries(db, boss),
      ]);
      if (events || messages || automations || webhooks) log("outbox.published", { events, messages, automations, webhooks });
    });
  });
  await boss.work<RecurringGenerationJob>(QUEUES.recurringGeneration, async (jobs) => {
    for (const job of jobs) {
      await observeJob(QUEUES.recurringGeneration, job.data, async () => {
        const result = await generateRecurringJobs(db, { tenantId: job.data.tenantId, planId: job.data.planId, through: job.data.through });
        log("recurring.generated", { tenantId: job.data.tenantId, ...result });
        return result;
      });
    }
  });
  // One poll per event can strand customer mail behind ordinary work bursts.
  // Drain a bounded batch serially; tenant claims and replay protection remain.
  await boss.work<DomainEventJob>(QUEUES.domainEvent, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) await observeJob(QUEUES.domainEvent, job.data, () => processDomainEvent(db, boss, job.data));
  });
  await boss.work<AutomationRunJob>(QUEUES.automationRun, async (jobs) => {
    for (const job of jobs) await observeJob(QUEUES.automationRun, job.data, () => processAutomationRun(db, boss, job.data));
  });
  await boss.work<OutboundMessageJob>(QUEUES.outboundMessage, async (jobs) => {
    for (const job of jobs) await observeJob(QUEUES.outboundMessage, job.data, () => processOutboundMessage(db, createConnectorRegistry({ mockConnectors: config.mockConnectors, includePlannedProviders: true }), job.data, new Date(), config));
  });
  await boss.work<WebhookDeliveryJob>(QUEUES.webhookDelivery, async (jobs) => {
    for (const job of jobs) await observeJob(QUEUES.webhookDelivery, job.data, () => processWebhookDelivery(db, boss, job.data, resolveSecret));
  });
}

export async function startWorker(env: Record<string, string | undefined> = process.env): Promise<{ stop: () => Promise<void>; boss: PgBoss; db: Database }> {
  const config = readServerConfig(env);
  await createPlatformBillingProvider(config.platformBilling).validatePlans();
  const connectionString = config.databaseUrl;
  if (!connectionString) throw new Error("DATABASE_URL is required for the background worker");
  const db = createDatabase(connectionString);
  const boss = new PgBoss({ connectionString, migrate: config.environment !== "production", createSchema: config.environment !== "production" });
  let stopping = false;
  let health: Awaited<ReturnType<typeof startHealthServer>> | undefined;
  boss.on("error", () => log("queue.error"));
  try {
    const { initializePlatformTrials } = await import("@modular-crm/db");
    await initializePlatformTrials(db, config.platformBilling);
    await boss.start();
    await registerWorkerQueues(boss);
    await registerWorkerHandlers(db, boss, environmentSecretResolver(env), config);
    await boss.schedule(QUEUES.publishOutbox, "* * * * *", {}, { tz: "UTC" });
    await boss.schedule(QUEUES.recurringGeneration, "0 3 * * *", {}, { tz: "UTC" });
    await boss.send(QUEUES.publishOutbox, {});
    await boss.send(QUEUES.recurringGeneration, {});
    health = await startHealthServer({ port: config.workerHealthPort, connectionString, isRunning: () => !stopping && jobLoopRunning(boss,
      { pollStaleMs: config.workerPollStaleMs, jobMaxMs: config.workerJobMaxMs }) });
    const outboxSweep = setInterval(() => {
      void boss.send(QUEUES.publishOutbox, {}).catch(() => log("outbox.enqueue_failed"));
    }, 15_000);
    log("started", { queues: Object.values(QUEUES) });
    return { boss, db, stop: async () => { stopping = true; clearInterval(outboxSweep); await health?.stop(); await boss.stop(); await closeDatabase(db); log("stopped"); } };
  } catch (error) {
    stopping = true;
    await health?.stop().catch(() => undefined);
    await boss.stop().catch(() => undefined);
    await closeDatabase(db);
    throw error;
  }
}

const calledAsEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (calledAsEntry) {
  startWorker().then(({ stop }) => {
    let stopping = false;
    const shutdown = () => { if (stopping) return; stopping = true; void stop().then(() => process.exit(0), () => { log("shutdown.error"); process.exit(1); }); };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch(() => { log("startup.error"); process.exitCode = 1; });
}
