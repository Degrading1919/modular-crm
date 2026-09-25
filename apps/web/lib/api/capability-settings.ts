import { randomUUID } from "node:crypto";
import { and, desc, eq, exists, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { CAPABILITY_LABELS, type CapabilityKey, type ConnectorManifest } from "@modular-crm/connectors";
import { validateAutomationRule, type AutomationAction, type AutomationActionType, type AutomationRule } from "@modular-crm/automations";
import type { Condition } from "@modular-crm/config";
import {
  automationRules, automationRuns, communicationEvents, connectorInstallations, customerContacts, customers, domainEvents,
  hasUsableFeature, jobAssignments, jobs, loadTenantCapabilities, organizationLocations, organizations, outboundMessages, tenants,
} from "@modular-crm/db";
import { DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { applyConnectorInstallationToRegistry, getRegistry, hydrateTenantConnectors, setConnectorState } from "../connectors";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { recordEvent } from "./events";
import { json, readBody, requireMethod } from "./http";
import { uuidArray } from "./sql";
import { getIndustryPack, getIndustryPackMaturity, resolveIndustryPack, validateIndustryPackCustomization } from "./industry-pack-runtime";

const automationActionTypes = new Set<AutomationActionType>([
  "send_email", "send_sms", "create_ticket", "add_note", "notify_staff",
]);
const conditionOperators = new Set([
  "equals", "not_equals", "in", "not_in", "exists", "not_exists", "greater_than", "greater_or_equal",
  "less_than", "less_or_equal", "contains", "not_contains", "starts_with", "ends_with", "before", "after",
  "within_days", "changed", "changed_from", "changed_to",
]);
const unsafePathSegments = new Set(["__proto__", "prototype", "constructor"]);
const MAX_AUTOMATION_DELAY_MINUTES = 525_600;
export const connectorFeature: Partial<Record<CapabilityKey, string>> = {
  payments: "payment_collection",
  email: "customer_notifications",
  sms: "customer_notifications",
  accounting: "invoicing",
  calendar: "service_scheduling",
  routing: "route_planning",
  geocoding: "route_planning",
  payroll: "payroll_inputs",
  crm_import: "data_import_export",
};

export async function usableConnectorCapabilities(tenantId: string, manifest: ConnectorManifest): Promise<CapabilityKey[]> {
  const featureKeys = manifest.capabilities.map((capability) => connectorFeature[capability]).filter((feature): feature is string => !!feature);
  const state = featureKeys.length ? await loadTenantCapabilities(getDb(), tenantId) : undefined;
  return manifest.capabilities.filter((capability) => {
    const feature = connectorFeature[capability];
    return !feature || (state ? hasUsableFeature(state, feature) : false);
  });
}

export async function assertConnectorEntitlement(tenantId: string, manifest: ConnectorManifest): Promise<CapabilityKey[]> {
  const capabilities = await usableConnectorCapabilities(tenantId, manifest);
  if (capabilities.length === 0) throw new DomainError("CAPABILITY_UNAVAILABLE", "Add or enable the related business capability before connecting this service.", 403);
  return capabilities;
}

const automationBodySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(600).optional(),
  trigger: z.unknown().optional(),
  triggerConfig: z.unknown().optional(),
  conditions: z.unknown().optional(),
  actions: z.unknown().optional(),
  action: z.string().trim().optional(),
  status: z.enum(["active", "draft", "paused", "archived"]).optional(),
}).passthrough();

const messageBodySchema = z.object({
  channel: z.enum(["email", "sms"]),
  recipient: z.string().trim().max(254).optional(),
  customerId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  subject: z.string().trim().max(180).optional(),
  message: z.string().trim().min(1).max(5_000),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

const settingsBodySchema = z.object({
  businessName: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.email().max(254), z.literal("")]).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  address: z.string().trim().max(250).optional(),
}).strict();

type ParsedRule = {
  name: string;
  description: string | undefined;
  status: "active" | "draft" | "paused" | "archived";
  triggerConfig: { event: string; filters?: Condition };
  conditions: Condition | Record<string, never>;
  actions: AutomationAction[];
};
type StaffSessionActor = SessionActor & { kind: "staff"; membershipId: string; organizationId: string };
type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safePath(path: unknown): path is string {
  return typeof path === "string" && path.length <= 200 && path.split(".").length <= 12
    && path.split(".").every((part) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part) && !unsafePathSegments.has(part));
}

function safeJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 10) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 2_000;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => safeJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 100 && entries.every(([key, item]) => !unsafePathSegments.has(key) && safeJsonValue(item, depth + 1));
}

function normalizeCondition(value: unknown, depth = 0): Condition | undefined {
  if (value === undefined || value === null) return undefined;
  if (depth > 8 || !isRecord(value)) throw validation("Conditions must use a supported rule group or comparison.");
  if (Object.keys(value).length === 0) return undefined;

  if (Object.keys(value).length === 1 && ("all" in value || "any" in value)) {
    const key = "all" in value ? "all" : "any";
    const items = value[key];
    if (!Array.isArray(items) || items.length < 1 || items.length > 25) throw validation("Condition groups need 1–25 checks.");
    return { [key]: items.map((item) => normalizeCondition(item, depth + 1)!) } as Condition;
  }
  if (Object.keys(value).length === 1 && "not" in value) {
    return { not: normalizeCondition(value.not, depth + 1)! };
  }

  const allowedKeys = new Set(["field", "operator", "value"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) || !safePath(value.field)
    || typeof value.operator !== "string" || !conditionOperators.has(value.operator)) {
    throw validation("A condition uses an unsupported field or operator.");
  }
  if ("value" in value && !safeJsonValue(value.value)) throw validation("A condition value is too large or is not plain JSON.");
  if ((value.operator === "in" || value.operator === "not_in") && !Array.isArray(value.value)) throw validation("The in operator needs a list of values.");
  if (value.operator === "within_days" && (typeof value.value !== "number" || value.value < 0 || value.value > 3650)) throw validation("within_days needs a number from 0 to 3,650.");
  if (isRecord(value.value) && Object.keys(value.value).length === 1 && "path" in value.value && !safePath(value.value.path)) {
    throw validation("A condition reference uses an unsupported field path.");
  }
  return { field: value.field, operator: value.operator, ...(Object.hasOwn(value, "value") ? { value: value.value } : {}) } as Condition;
}

function normalizeTriggerFilters(value: unknown): Condition | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    if (value.length > 25) throw validation("A trigger can have up to 25 filters.");
    return { all: value.map((item) => normalizeCondition(item)!) };
  }
  return normalizeCondition(value);
}

function normalizeActions(value: unknown, simpleAction?: string): AutomationAction[] {
  const rawActions = Array.isArray(value) ? value : simpleAction ? [{ actionType: simpleAction, configuration: simpleAction === "create_ticket" ? { type: "general" } : {} }] : undefined;
  if (!rawActions || rawActions.length < 1 || rawActions.length > 20) throw validation("Add between 1 and 20 automation actions.");
  return rawActions.map((raw): AutomationAction => {
    if (!isRecord(raw)) throw validation("Each automation action must be a structured action.");
    const actionType = raw.actionType ?? raw.type;
    if (typeof actionType !== "string" || !automationActionTypes.has(actionType as AutomationActionType)) {
      throw validation("Choose an action this workspace can run safely.");
    }
    const configSource = isRecord(raw.configuration) ? raw.configuration : raw;
    const allowedConfig = actionType === "send_email" || actionType === "send_sms"
      ? new Set(["templateKey", "to", "subject", "body", "customerId"])
      : actionType === "create_ticket" ? new Set(["type", "title", "description"])
        : actionType === "notify_staff" ? new Set(["title", "body"])
          : new Set(["body"]);
    const configuration: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(configSource)) {
      if (key === "actionType" || key === "type" || key === "configuration" || key === "delay" || key === "continueOnError" || key === "dedupeKeyTemplate") continue;
      if (!allowedConfig.has(key)) throw validation(`The ${actionType} action does not support ${key}.`);
      if (typeof item !== "string" || item.length > (key === "body" || key === "description" ? 5_000 : 254)) throw validation(`The ${key} action setting is invalid.`);
      configuration[key] = item.trim();
    }
    if (actionType === "add_note" && !String(configuration.body ?? "").trim()) throw validation("Add a note body before saving this automation.");

    let delay: AutomationAction["delay"];
    if (raw.delay !== undefined) {
      if (!isRecord(raw.delay)) throw validation("Automation delays must be relative to an event or date field.");
      if (Object.keys(raw.delay).length === 1 && Number.isSafeInteger(raw.delay.afterEventMinutes)
        && Number(raw.delay.afterEventMinutes) >= 0 && Number(raw.delay.afterEventMinutes) <= MAX_AUTOMATION_DELAY_MINUTES) {
        delay = { afterEventMinutes: Number(raw.delay.afterEventMinutes) };
      } else if (Object.keys(raw.delay).length === 2 && safePath(raw.delay.relativeToField)
        && Number.isSafeInteger(raw.delay.offsetMinutes) && Math.abs(Number(raw.delay.offsetMinutes)) <= MAX_AUTOMATION_DELAY_MINUTES) {
        delay = { relativeToField: raw.delay.relativeToField, offsetMinutes: Number(raw.delay.offsetMinutes) };
      } else throw validation("The automation delay is outside the supported range.");
    }
    if (raw.continueOnError !== undefined && typeof raw.continueOnError !== "boolean") throw validation("continueOnError must be true or false.");
    if (raw.dedupeKeyTemplate !== undefined && (typeof raw.dedupeKeyTemplate !== "string" || raw.dedupeKeyTemplate.length > 300)) throw validation("The deduplication key is invalid.");
    const action: AutomationAction = {
      actionType: actionType as AutomationActionType,
      configuration,
      ...(delay ? { delay } : {}),
      ...(typeof raw.continueOnError === "boolean" ? { continueOnError: raw.continueOnError } : {}),
      ...(typeof raw.dedupeKeyTemplate === "string" ? { dedupeKeyTemplate: raw.dedupeKeyTemplate } : {}),
    };
    return action;
  });
}

/** Convert the compact BusinessApp form or declarative rule payload to the worker's versioned rule shape. */
export function normalizeAutomationRuleInput(input: unknown, identity: { tenantId: string; id: string; version?: number; fallback?: Partial<ParsedRule> }): ParsedRule {
  const parsed = automationBodySchema.parse(input);
  const fallback = identity.fallback;
  const triggerSource = parsed.triggerConfig ?? parsed.trigger ?? fallback?.triggerConfig;
  let triggerEvent: unknown;
  let triggerFilters: unknown;
  if (typeof triggerSource === "string") {
    triggerEvent = triggerSource;
    triggerFilters = fallback?.triggerConfig?.filters;
  } else if (isRecord(triggerSource)) {
    triggerEvent = triggerSource.event;
    triggerFilters = triggerSource.filters;
  }
  if (typeof triggerEvent !== "string" || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(triggerEvent) || triggerEvent.length > 120) {
    throw validation("Choose a valid business event for this automation.");
  }
  const normalizedFilters = normalizeTriggerFilters(triggerFilters);
  const triggerConfig = { event: triggerEvent, ...(normalizedFilters ? { filters: normalizedFilters } : {}) };
  const conditions = normalizeCondition(parsed.conditions ?? fallback?.conditions) ?? {};
  const actions = normalizeActions(parsed.actions ?? fallback?.actions, parsed.action);
  const name = parsed.name ?? fallback?.name;
  if (!name) throw validation("Give this automation a name.");
  const status = parsed.status ?? fallback?.status ?? "active";
  const rule: AutomationRule = {
    id: identity.id, tenantId: identity.tenantId, version: identity.version ?? 1, name,
    description: parsed.description ?? fallback?.description ?? undefined,
    source: "tenant", status: status === "active" ? "active" : "inactive",
    trigger: { event: triggerConfig.event, filters: triggerConfig.filters },
    conditions: Object.keys(conditions).length ? conditions as Condition : undefined,
    actions,
  };
  try { validateAutomationRule(rule); }
  catch (error) { throw validation(error instanceof Error ? error.message : "This automation could cause an unsafe event loop."); }
  return { name, description: rule.description, status, triggerConfig, conditions, actions };
}

function validation(message: string): DomainError { return new DomainError("VALIDATION_ERROR", message, 422); }

function normalizeConnectorStatus(manifest: ConnectorManifest, databaseStatus: string | undefined, runtimeState: string): string {
  if (manifest.availability === "planned") return "coming_soon";
  if (manifest.availability === "credentials_ready" && runtimeState !== "connected") return databaseStatus === "connected" ? "needs_attention" : "not_connected";
  if (databaseStatus === "expired" || databaseStatus === "needs_attention" || databaseStatus === "error") return "needs_attention";
  if (databaseStatus === "connected" || runtimeState === "connected") return "connected";
  return "not_connected";
}

async function listConnections(actor: SessionActor): Promise<Response> {
  requirePermission(actor, "connectors.read");
  requireStaff(actor);
  const registry = await hydrateTenantConnectors(actor.tenantId);
  const industryPack = actor.packKey ? getIndustryPack(actor.packKey) : undefined;
  const recommendedCapabilities: ReadonlySet<string> = new Set(industryPack?.recommendedConnectorCapabilities ?? []);
  const installations = await getDb().select().from(connectorInstallations).where(eq(connectorInstallations.tenantId, actor.tenantId));
  const newestByKey = new Map<string, typeof installations[number]>();
  for (const installation of installations) {
    const current = newestByKey.get(installation.connectorKey);
    if (!current || installation.createdAt > current.createdAt) newestByKey.set(installation.connectorKey, installation);
  }
  const groups = Object.entries(CAPABILITY_LABELS).map(([capabilityKey, capability]) => {
    const items = registry.listCatalog(capabilityKey as CapabilityKey).filter((manifest) => manifest.availability !== "planned" && !manifest.platformManaged).map((manifest) => {
      const stored = newestByKey.get(manifest.key);
      const runtime = registry.healthCheck(actor.tenantId, manifest.key);
      const connectorStatus = normalizeConnectorStatus(manifest, stored?.status, runtime.state);
      return {
        key: manifest.key,
        name: manifest.name,
        description: manifest.description,
        capability,
        capabilityKey,
        recommendedForIndustry: recommendedCapabilities.has(capabilityKey),
        status: connectorStatus,
        health: stored?.status === "connected" ? runtime.health : stored?.status === "expired" || stored?.status === "needs_attention" ? "degraded" : "unavailable",
        mode: manifest.availability === "mock_complete" ? "mock" : manifest.authType === "oauth2" && manifest.availability === "credentials_ready" ? "oauth_setup" : manifest.availability === "credentials_ready" ? "live_setup" : "local",
        environment: manifest.availability === "mock_complete" ? "test" : manifest.availability === "credentials_ready" ? "production" : "local",
        ...(manifest.authType === "oauth2" && manifest.availability === "credentials_ready" ? {
          oauthAvailable: registry.isOAuthAvailable?.(manifest.key) ?? false,
          oauthStatus: connectorStatus === "connected" ? "connected" : connectorStatus === "needs_attention" ? "needs_attention" : "not_connected",
        } : {}),
        ...(manifest.credentialSetup ? { credentialConfigured: Boolean(stored?.credentialReference) } : {}),
        ...(stored?.healthCheckedAt ? { healthCheckedAt: stored.healthCheckedAt.toISOString() } : {}),
        ...(stored?.lastSuccessAt ? { lastSuccessAt: stored.lastSuccessAt.toISOString() } : {}),
        ...(stored?.lastErrorCode ? { lastErrorCode: stored.lastErrorCode } : runtime.lastErrorCode ? { lastErrorCode: runtime.lastErrorCode } : {}),
        ...(manifest.credentialSetup && manifest.credentialFields ? { credentialFields: manifest.credentialFields } : {}),
      };
    });
    return { capabilityKey, capability, items };
  }).filter((group) => group.items.length > 0);
  return json({
    groups,
    items: groups.flatMap((group) => group.items),
    ...(industryPack ? { industryPack: { key: industryPack.key, displayName: industryPack.displayName, recommendedConnectorCapabilities: industryPack.recommendedConnectorCapabilities } } : {}),
  });
}

async function changeConnection(request: Request, path: string[], actor: SessionActor): Promise<Response> {
  if (path.length !== 3 || !["connect", "disconnect", "reconnect"].includes(path[2]!)) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  requireMethod(request, "POST");
  const action = path[2]!;
  requirePermission(actor, action === "disconnect" ? "connectors.disconnect" : action === "reconnect" ? "connectors.configure" : "connectors.install");
  requireStaff(actor);
  const connectorKey = path[1]!;
  const registry = getRegistry();
  const manifest = registry.listCatalog().find((candidate) => candidate.key === connectorKey);
  if (!manifest || manifest.availability === "planned" || manifest.platformManaged) throw new DomainError("NOT_FOUND", "Connection is not available yet.", 404);
  if (action !== "disconnect") await assertConnectorEntitlement(actor.tenantId, manifest);
  const db = getDb();
  if (manifest.authType === "oauth2") {
    if (action !== "disconnect") return setConnectorState(actor.tenantId, connectorKey, true).then((state) =>
      json({ item: { key: connectorKey, name: manifest.name, status: state.state, health: state.health, mode: "live", environment: "production" } }));

    // Provider revocation is an external best-effort action and cannot share the local DB transaction.
    // If the following DB/event transaction fails, keep local credentials/status and runtime state intact.
    const { persistOAuthDisconnect, prepareOAuthDisconnect } = await import("./connector-oauth");
    const prepared = await prepareOAuthDisconnect(actor.tenantId, connectorKey);
    await db.transaction((tx) => persistOAuthDisconnect(tx, actor, connectorKey, prepared));
    const state = registry.disconnect(actor.tenantId, connectorKey);
    return json({ item: { key: connectorKey, name: manifest.name, status: state.state, health: state.health, mode: "live", environment: "production" } });
  }

  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(connectorInstallations)
      .where(and(eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey)))
      .orderBy(desc(connectorInstallations.createdAt)).limit(1);
    const nextState = await setConnectorState(actor.tenantId, connectorKey, action !== "disconnect", { writer: tx, deferRuntime: true });
    const [stored] = await tx.select().from(connectorInstallations)
      .where(and(eq(connectorInstallations.tenantId, actor.tenantId), eq(connectorInstallations.connectorKey, connectorKey)))
      .orderBy(desc(connectorInstallations.createdAt)).limit(1);
    if (stored) await recordEvent(actor, {
      type: action === "disconnect" ? "connector.disconnected" : "connector.connected",
      entityType: "connector_installation", entityId: stored.id,
      payload: { connectorKey, mode: manifest.availability === "mock_complete" ? "mock" : manifest.availability === "credentials_ready" ? "live" : "local", health: nextState.health },
      auditAction: action === "disconnect" ? "connector.disconnect" : action === "reconnect" ? "connector.reconnect" : "connector.connect",
      before: before ? { status: before.status } : null,
      after: { status: stored.status, mode: manifest.availability === "mock_complete" ? "mock" : manifest.availability === "credentials_ready" ? "live" : "local" },
    }, tx);
    return { installation: stored, state: nextState };
  });
  const state = result.installation ? applyConnectorInstallationToRegistry(result.installation) : result.state;
  if (!state) throw new DomainError("EXTERNAL_SERVICE_ERROR", "The connection could not be saved.", 503);
  const mode = manifest.availability === "mock_complete" ? "mock" : manifest.availability === "credentials_ready" ? "live" : "local";
  const environment = manifest.availability === "mock_complete" ? "test" : manifest.availability === "credentials_ready" ? "production" : "local";
  return json({ item: { key: connectorKey, name: manifest.name, status: state.state === "connected" ? "connected" : "not_connected", health: state.health, mode, environment } });
}

function ruleView(row: typeof automationRules.$inferSelect, lastRun?: typeof automationRuns.$inferSelect) {
  const triggerConfig = row.triggerConfig as { event?: string; filters?: unknown };
  return {
    id: row.id, name: row.name, description: row.description ?? "", source: row.source, sourceKey: row.sourceKey,
    trigger: triggerConfig.event ?? "", triggerConfig: row.triggerConfig, conditions: row.conditions, actions: row.actions,
    status: row.archivedAt ? "archived" : row.status, version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    lastRunAt: (lastRun?.completedAt ?? lastRun?.startedAt ?? lastRun?.createdAt)?.toISOString() ?? null,
    lastRunStatus: lastRun?.status ?? null,
  };
}

function safeRunError(code: string | null): string | null {
  if (!code) return null;
  if (code === "recipient_missing") return "No customer contact is available for this message.";
  if (code === "ticket_configuration_missing") return "Set up an open request type before using this action.";
  if (code === "authorization_expired") return "Reconnect the service used by this action.";
  if (code === "connector_unavailable") return "The connected service is unavailable right now.";
  if (code === "invalid_rule" || code === "invalid_configuration") return "Review the rule setup before trying again.";
  return "This action could not be completed.";
}

async function listAutomationRuns(actor: SessionActor, ruleId?: string, requestUrl = "http://localhost"): Promise<Response> {
  requirePermission(actor, "automations.runs_read");
  requireStaff(actor);
  const db = getDb();
  if (ruleId) {
    const [rule] = await db.select({ id: automationRules.id }).from(automationRules)
      .where(and(eq(automationRules.id, ruleId), eq(automationRules.tenantId, actor.tenantId))).limit(1);
    if (!rule) throw new DomainError("NOT_FOUND", "Automation not found.", 404);
  }
  const limit = Math.min(200, Math.max(1, Number(new URL(requestUrl).searchParams.get("limit")) || 100));
  const runConditions: SQL[] = [eq(automationRuns.tenantId, actor.tenantId)];
  if (ruleId) runConditions.push(eq(automationRuns.automationRuleId, ruleId));
  if (!actor.allLocations) {
    const locationIds = [...actor.locationIds];
    if (!locationIds.length) return json({ items: [] });
    runConditions.push(inArray(domainEvents.locationId, locationIds));
  }
  const rows = await db.select({ run: automationRuns, eventType: domainEvents.eventType, eventOccurredAt: domainEvents.occurredAt, entityType: domainEvents.entityType, entityId: domainEvents.entityId })
    .from(automationRuns).innerJoin(domainEvents, and(eq(domainEvents.id, automationRuns.triggeringEventId), eq(domainEvents.tenantId, actor.tenantId)))
    .where(and(...runConditions))
    .orderBy(desc(automationRuns.createdAt)).limit(limit);
  return json({ items: rows.map(({ run, eventType, eventOccurredAt, entityType, entityId }) => ({
    id: run.id, ruleId: run.automationRuleId, ruleVersion: run.ruleVersion, triggeringEventId: run.triggeringEventId,
    trigger: eventType, entityType, entityId, eventOccurredAt: eventOccurredAt.toISOString(),
    status: run.status, attempts: run.attempts, startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null, nextRetryAt: run.nextRetryAt?.toISOString() ?? null,
    retryable: run.status === "retry",
    errorCode: run.errorCode, errorMessage: safeRunError(run.errorCode), createdAt: run.createdAt.toISOString(),
  })) });
}

async function retryAutomationRun(actor: SessionActor, runId: string): Promise<Response> {
  requirePermission(actor, "automations.runs_retry");
  requireStaff(actor);
  const db = getDb();
  const locationCondition = !actor.allLocations
    ? actor.locationIds.size
      ? inArray(domainEvents.locationId, [...actor.locationIds])
      : undefined
    : undefined;
  if (!actor.allLocations && !locationCondition) throw new DomainError("NOT_FOUND", "Automation run not found.", 404);

  const run = await db.transaction(async (tx) => {
    const scopeConditions: SQL[] = [
      eq(automationRuns.id, runId), eq(automationRuns.tenantId, actor.tenantId),
      eq(domainEvents.tenantId, actor.tenantId),
    ];
    if (locationCondition) scopeConditions.push(locationCondition);
    const [scoped] = await tx.select({ run: automationRuns })
      .from(automationRuns).innerJoin(domainEvents, and(
        eq(domainEvents.id, automationRuns.triggeringEventId), eq(domainEvents.tenantId, actor.tenantId),
      ))
      .where(and(...scopeConditions)).limit(1);
    if (!scoped) throw new DomainError("NOT_FOUND", "Automation run not found.", 404);
    if (scoped.run.status !== "retry") throw new DomainError("CONFLICT", "This automation run is not eligible for retry.", 409);

    // A null retry time is immediately eligible in enqueuePendingAutomationRuns.
    // Keep the run snapshot unchanged so completedActionKeys and effect idempotency remain intact.
    const updateConditions: SQL[] = [
      eq(automationRuns.id, runId), eq(automationRuns.tenantId, actor.tenantId), eq(automationRuns.status, "retry"),
    ];
    const scopedEvent = tx.select({ id: domainEvents.id }).from(domainEvents).where(and(
      eq(domainEvents.id, automationRuns.triggeringEventId), eq(domainEvents.tenantId, actor.tenantId),
      ...(locationCondition ? [locationCondition] : []),
    ));
    updateConditions.push(exists(scopedEvent));
    const [updated] = await tx.update(automationRuns).set({ nextRetryAt: null, updatedAt: new Date() })
      .where(and(...updateConditions)).returning();
    if (!updated) throw new DomainError("CONFLICT", "This automation run is no longer eligible for retry.", 409);
    await recordEvent(actor, {
      type: "automation_run.retry_requested", entityType: "automation_run", entityId: updated.id,
      payload: { ruleId: updated.automationRuleId, attempts: updated.attempts },
      auditAction: "automation.run_retry",
      before: { status: scoped.run.status, nextRetryAt: scoped.run.nextRetryAt?.toISOString() ?? null },
      after: { status: updated.status, nextRetryAt: null },
    }, tx);
    return updated;
  });
  return json({ item: {
    id: run.id, status: run.status, attempts: run.attempts,
    nextRetryAt: null, retryable: run.status === "retry",
  } });
}

async function handleAutomations(request: Request, path: string[], actor: SessionActor): Promise<Response> {
  requireStaff(actor);
  const db = getDb();
  if (path.length === 1 && request.method === "GET") {
    requirePermission(actor, "automations.read");
    const ruleRows = await db.select().from(automationRules).where(and(eq(automationRules.tenantId, actor.tenantId), isNull(automationRules.archivedAt))).orderBy(desc(automationRules.updatedAt)).limit(200);
    let runs: (typeof automationRuns.$inferSelect)[] = [];
    if (ruleRows.length && actor.allLocations) {
      runs = await db.select().from(automationRuns)
        .where(and(eq(automationRuns.tenantId, actor.tenantId), inArray(automationRuns.automationRuleId, ruleRows.map((row) => row.id))))
        .orderBy(desc(automationRuns.createdAt)).limit(1_000);
    } else if (ruleRows.length && actor.locationIds.size > 0) {
      const scopedRuns = await db.select({ run: automationRuns }).from(automationRuns)
        .innerJoin(domainEvents, and(eq(domainEvents.id, automationRuns.triggeringEventId), eq(domainEvents.tenantId, actor.tenantId)))
        .where(and(eq(automationRuns.tenantId, actor.tenantId), inArray(automationRuns.automationRuleId, ruleRows.map((row) => row.id)), inArray(domainEvents.locationId, [...actor.locationIds])))
        .orderBy(desc(automationRuns.createdAt)).limit(1_000);
      runs = scopedRuns.map(({ run }) => run);
    }
    const lastRun = new Map<string, typeof automationRuns.$inferSelect>();
    for (const run of runs) if (!lastRun.has(run.automationRuleId)) lastRun.set(run.automationRuleId, run);
    return json({ items: ruleRows.map((row) => ruleView(row, lastRun.get(row.id))) });
  }
  if (path.length === 1 && request.method === "POST") {
    requirePermission(actor, "automations.create");
    const body = await readBody(request, automationBodySchema);
    const id = randomUUID();
    const status = body.status ?? "active";
    if (status === "active") requirePermission(actor, "automations.activate");
    const parsed = normalizeAutomationRuleInput(body, { tenantId: actor.tenantId, id, version: 1 });
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(automationRules).values({
        tenantId: actor.tenantId, name: parsed.name, description: parsed.description ?? null, source: "tenant", status: parsed.status,
        version: 1, triggerConfig: parsed.triggerConfig, conditions: parsed.conditions, actions: parsed.actions,
        createdByMembershipId: actor.membershipId,
      }).returning();
      if (!row) throw new Error("Automation could not be created");
      await recordEvent(actor, { type: "automation_rule.created", entityType: "automation_rule", entityId: row.id, auditAction: "automation.create", after: { name: row.name, status: row.status, version: row.version } }, tx);
      return row;
    });
    return json({ item: ruleView(created) }, 201);
  }
  if (path.length === 4 && path[1] === "runs" && path[3] === "retry" && request.method === "POST") {
    return retryAutomationRun(actor, path[2]!,);
  }
  if (path.length === 2 && path[1] === "runs" && request.method === "GET") return listAutomationRuns(actor, undefined, request.url);
  if (path.length === 2 && request.method === "GET") {
    requirePermission(actor, "automations.read");
    const [row] = await db.select().from(automationRules).where(and(eq(automationRules.id, path[1]!), eq(automationRules.tenantId, actor.tenantId), isNull(automationRules.archivedAt))).limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "Automation not found.", 404);
    return json({ item: ruleView(row) });
  }
  if (path.length === 3 && path[2] === "runs" && request.method === "GET") return listAutomationRuns(actor, path[1], request.url);
  if (path.length === 2 && request.method === "PATCH") {
    const body = await readBody(request, automationBodySchema);
    const hasDefinitionChange = ["name", "description", "trigger", "triggerConfig", "conditions", "actions", "action"].some((key) => Object.hasOwn(body, key));
    if (hasDefinitionChange) requirePermission(actor, "automations.update");
    if (body.status === "active") requirePermission(actor, "automations.activate");
    if (body.status === "archived") requirePermission(actor, "automations.archive");
    if (!hasDefinitionChange && !body.status) throw validation("Choose a setting to update.");
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(automationRules)
        .where(and(eq(automationRules.id, path[1]!), eq(automationRules.tenantId, actor.tenantId), isNull(automationRules.archivedAt))).limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "Automation not found.", 404);
      const nextStatus = body.status ?? current.status as ParsedRule["status"];
      const nextVersion = current.version + 1;
      let result: typeof current;
      if (!hasDefinitionChange) {
        const [row] = await tx.update(automationRules).set({ status: nextStatus, archivedAt: nextStatus === "archived" ? new Date() : current.archivedAt, version: nextVersion, updatedAt: new Date() })
          .where(and(eq(automationRules.id, current.id), eq(automationRules.tenantId, actor.tenantId))).returning();
        if (!row) throw new DomainError("NOT_FOUND", "Automation not found.", 404);
        result = row;
      } else {
        const triggerConfig = current.triggerConfig as ParsedRule["triggerConfig"];
        const fallback: Partial<ParsedRule> = {
          name: current.name, description: current.description ?? undefined, status: current.status as ParsedRule["status"],
          triggerConfig, conditions: current.conditions as Condition ?? {}, actions: current.actions as AutomationAction[],
        };
        const parsed = normalizeAutomationRuleInput(body, { tenantId: actor.tenantId, id: current.id, version: nextVersion, fallback });
        if (current.source === "tenant") {
          const [row] = await tx.update(automationRules).set({ name: parsed.name, description: parsed.description ?? null, status: parsed.status,
            version: nextVersion, triggerConfig: parsed.triggerConfig, conditions: parsed.conditions, actions: parsed.actions,
            archivedAt: parsed.status === "archived" ? new Date() : null, updatedAt: new Date() })
            .where(and(eq(automationRules.id, current.id), eq(automationRules.tenantId, actor.tenantId))).returning();
          if (!row) throw new DomainError("NOT_FOUND", "Automation not found.", 404);
          result = row;
        } else {
          const [copy] = await tx.insert(automationRules).values({ tenantId: actor.tenantId, name: parsed.name, description: parsed.description ?? null,
            source: "tenant", sourceKey: current.sourceKey, status: parsed.status, version: nextVersion, triggerConfig: parsed.triggerConfig,
            conditions: parsed.conditions, actions: parsed.actions, createdByMembershipId: actor.membershipId, archivedAt: parsed.status === "archived" ? new Date() : null })
            .returning();
          if (!copy) throw new Error("Automation override could not be created");
          await tx.update(automationRules).set({ status: "archived", archivedAt: new Date(), version: current.version + 1, updatedAt: new Date() })
            .where(and(eq(automationRules.id, current.id), eq(automationRules.tenantId, actor.tenantId)));
          await recordEvent(actor, { type: "automation_rule.archived", entityType: "automation_rule", entityId: current.id, auditAction: "automation.override_source_archived", before: { status: current.status, source: current.source }, after: { status: "archived" } }, tx);
          result = copy;
        }
      }
      const action = result.status === "archived" ? "automation.archive" : result.status === "active" && current.status !== "active" ? "automation.activate" : "automation.update";
      await recordEvent(actor, { type: result.status === "archived" ? "automation_rule.archived" : result.status === "active" && current.status !== "active" ? "automation_rule.activated" : "automation_rule.updated",
        entityType: "automation_rule", entityId: result.id, auditAction: action,
        before: { name: current.name, status: current.status, version: current.version }, after: { name: result.name, status: result.status, version: result.version, sourceKey: result.sourceKey } }, tx);
      return result;
    });
    return json({ item: ruleView(updated) });
  }
  throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
}

async function listCommunications(request: Request, actor: SessionActor): Promise<Response> {
  requirePermission(actor, "communications.read");
  requireStaff(actor);
  const db = getDb();
  const search = new URL(request.url).searchParams;
  const limit = Math.min(200, Math.max(1, Number(search.get("limit")) || 100));
  const conditions: SQL[] = [eq(outboundMessages.tenantId, actor.tenantId)];
  if (!actor.allLocations) {
    const locationIds = [...actor.locationIds];
    if (!locationIds.length) return json({ items: [] });
    conditions.push(sql`coalesce(${jobs.organizationLocationId}, ${customers.owningLocationId}) = any(${uuidArray(locationIds)})`);
  }
  if (actor.role === "technician") {
    const permittedAssignments = db.select({ id: jobAssignments.id }).from(jobAssignments).where(and(
      eq(jobAssignments.tenantId, actor.tenantId), eq(jobAssignments.jobId, outboundMessages.jobId),
      eq(jobAssignments.membershipId, actor.membershipId!), isNull(jobAssignments.removedAt),
    ));
    conditions.push(exists(permittedAssignments));
  }
  const messages = await db.select({ message: outboundMessages, customerName: customers.displayName, locationId: sql<string | null>`coalesce(${jobs.organizationLocationId}, ${customers.owningLocationId})` })
    .from(outboundMessages).leftJoin(customers, and(eq(customers.id, outboundMessages.customerId), eq(customers.tenantId, actor.tenantId)))
    .leftJoin(jobs, and(eq(jobs.id, outboundMessages.jobId), eq(jobs.tenantId, actor.tenantId)))
    .where(and(...conditions)).orderBy(desc(outboundMessages.queuedAt)).limit(limit);
  const ids = messages.map(({ message }) => message.id);
  const events = ids.length ? await db.select().from(communicationEvents)
    .where(and(eq(communicationEvents.tenantId, actor.tenantId), inArray(communicationEvents.outboundMessageId, ids)))
    .orderBy(desc(communicationEvents.occurredAt)) : [];
  const eventsByMessage = new Map<string, typeof communicationEvents.$inferSelect[]>();
  for (const event of events) eventsByMessage.set(event.outboundMessageId, [...(eventsByMessage.get(event.outboundMessageId) ?? []), event]);
  const installationIds = [...new Set(messages.map(({ message }) => message.connectorInstallationId).filter((id): id is string => !!id))];
  const installationRows = installationIds.length ? await db.select({ id: connectorInstallations.id, connectorKey: connectorInstallations.connectorKey })
    .from(connectorInstallations).where(and(eq(connectorInstallations.tenantId, actor.tenantId), inArray(connectorInstallations.id, installationIds))) : [];
  const connectorKeys = new Map(installationRows.map((row) => [row.id, row.connectorKey]));
  return json({ items: messages.map(({ message, customerName, locationId }) => ({
    id: message.id, tenantId: message.tenantId, customerId: message.customerId, customerName: customerName ?? null,
    jobId: message.jobId, locationId, recipient: message.recipient, channel: message.channel,
    subject: message.renderedSubject ?? "", message: message.renderedBody, templateKey: message.templateKey,
    status: message.status, queuedAt: message.queuedAt.toISOString(), sentAt: message.sentAt?.toISOString() ?? null,
    deliveredAt: message.deliveredAt?.toISOString() ?? null, failureCode: message.failureCode,
    errorMessage: message.failureCode ? safeRunError(message.failureCode) ?? "Delivery could not be completed." : null,
    history: (eventsByMessage.get(message.id) ?? []).map((event) => ({ type: event.eventType, occurredAt: event.occurredAt.toISOString() })),
    mode: message.status === "queued" || message.status === "sending" || message.status === "retry" ? "pending"
      : message.connectorInstallationId && connectorKeys.get(message.connectorInstallationId)?.startsWith("mock-") === false ? "connected" : "mock",
    environment: message.status === "queued" || message.status === "sending" || message.status === "retry" ? null
      : message.connectorInstallationId && connectorKeys.get(message.connectorInstallationId)?.startsWith("mock-") === false ? "production" : "test",
  })) });
}

async function authorizedCustomer(actor: StaffSessionActor, customerId: string, locationId?: string | null) {
  const [customer] = await getDb().select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, actor.tenantId))).limit(1);
  if (!customer) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
  if (!actor.allLocations && (!locationId || !actor.locationIds.has(locationId))) throw new DomainError("NOT_FOUND", "Customer not found.", 404);
  return customer;
}

async function authorizedJob(actor: StaffSessionActor, jobId: string) {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.tenantId, actor.tenantId))).limit(1);
  if (!job || (!actor.allLocations && (!job.organizationLocationId || !actor.locationIds.has(job.organizationLocationId)))) throw new DomainError("NOT_FOUND", "Job not found.", 404);
  if (actor.role === "technician") {
    const [assignment] = await db.select({ id: jobAssignments.id }).from(jobAssignments)
      .where(and(eq(jobAssignments.tenantId, actor.tenantId), eq(jobAssignments.jobId, jobId), eq(jobAssignments.membershipId, actor.membershipId!), isNull(jobAssignments.removedAt))).limit(1);
    if (!assignment) throw new DomainError("NOT_FOUND", "Job not found.", 404);
  }
  return job;
}

async function defaultRecipient(actor: StaffSessionActor, customerId: string | undefined, channel: "email" | "sms"): Promise<string | undefined> {
  if (!customerId) return undefined;
  const db = getDb();
  const [customer] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, actor.tenantId))).limit(1);
  if (!customer) return undefined;
  const direct = channel === "email" ? customer.billingEmail : customer.billingPhone;
  if (direct) return direct;
  const [contact] = await db.select().from(customerContacts)
    .where(and(eq(customerContacts.tenantId, actor.tenantId), eq(customerContacts.customerId, customerId), eq(customerContacts.isPrimary, true))).limit(1);
  return channel === "email" ? contact?.email ?? undefined : contact?.phone ?? undefined;
}

async function queueCommunication(request: Request, actor: SessionActor): Promise<Response> {
  requirePermission(actor, "communications.send");
  requireStaff(actor);
  const body = await readBody(request, messageBodySchema);
  if (body.channel === "sms" && body.message.length > 1_600) throw validation("Text messages must be 1,600 characters or fewer.");
  let job: typeof jobs.$inferSelect | undefined;
  let customerId = body.customerId;
  if (body.jobId) {
    job = await authorizedJob(actor, body.jobId);
    if (customerId && customerId !== job.customerId) throw new DomainError("NOT_FOUND", "Job not found.", 404);
    customerId ??= job.customerId;
  }
  if (actor.role === "technician" && !job) throw new DomainError("NOT_FOUND", "Choose an assigned job for this message.", 404);
  let locationId = job?.organizationLocationId ?? null;
  if (customerId) {
    const customer = job
      ? await authorizedCustomer(actor, customerId, job.organizationLocationId)
      : await authorizedCustomer(actor, customerId);
    locationId ??= customer.owningLocationId;
  }
  if (!actor.allLocations && !customerId && !job) throw new DomainError("NOT_FOUND", "Choose a customer or a job in your location.", 404);
  let recipient = body.recipient;
  if (!recipient && customerId) recipient = await defaultRecipient(actor, customerId, body.channel);
  if (!recipient) throw validation("Add a customer email address or phone number.");
  if (body.channel === "email") {
    const check = z.email().safeParse(recipient);
    if (!check.success) throw validation("Enter a valid email address.");
    recipient = check.data;
  } else {
    const compact = recipient.replace(/[\s()-]/g, "");
    if (!/^\+?[0-9]{7,15}$/.test(compact)) throw validation("Enter a valid phone number with 7–15 digits.");
    recipient = compact;
  }
  const idempotencyKey = body.idempotencyKey ?? randomUUID();
  const db = getDb();
  const inserted = await db.transaction(async (tx) => {
    const [created] = await tx.insert(outboundMessages).values({
      tenantId: actor.tenantId, customerId: customerId ?? null, jobId: job?.id ?? null, channel: body.channel,
      recipient, renderedSubject: body.channel === "email" ? body.subject || "Service update" : null,
      renderedBody: body.message, status: "queued", idempotencyKey, queuedAt: new Date(),
    }).onConflictDoNothing({ target: [outboundMessages.tenantId, outboundMessages.idempotencyKey] }).returning();
    if (!created) {
      const [existing] = await tx.select().from(outboundMessages).where(and(eq(outboundMessages.tenantId, actor.tenantId), eq(outboundMessages.idempotencyKey, idempotencyKey))).limit(1);
      if (!existing) throw new DomainError("CONFLICT", "This message could not be queued.", 409);
      if (existing.channel !== body.channel || existing.recipient !== recipient || existing.renderedBody !== body.message || existing.customerId !== (customerId ?? null) || existing.jobId !== (job?.id ?? null)) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This request key was already used for a different message.", 409);
      }
      return { row: existing, isNew: false };
    }
    await tx.insert(communicationEvents).values({ tenantId: actor.tenantId, outboundMessageId: created.id, eventType: "queued", occurredAt: new Date(), payload: {} });
    await recordEvent(actor, { type: "outbound_message.queued", entityType: "outbound_message", entityId: created.id, payload: { channel: body.channel, customerId: customerId ?? null, jobId: job?.id ?? null }, auditAction: "communication.message_queued", after: { channel: body.channel, status: "queued" }, locationId }, tx);
    return { row: created, isNew: true };
  });
  return json({ item: { id: inserted.row.id, channel: inserted.row.channel, recipient: inserted.row.recipient, status: inserted.row.status,
    queuedAt: inserted.row.queuedAt.toISOString(), mode: "pending", environment: null, ...(inserted.isNew ? {} : { idempotentReplay: true }) } }, inserted.isNew ? 201 : 200);
}

function objectValue(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }

async function primaryLocation(actor: StaffSessionActor, db: ReturnType<typeof getDb> | DbTransaction = getDb()) {
  const where = actor.defaultLocationId
    ? and(eq(organizationLocations.id, actor.defaultLocationId), eq(organizationLocations.tenantId, actor.tenantId), eq(organizationLocations.organizationId, actor.organizationId!))
    : and(eq(organizationLocations.tenantId, actor.tenantId), eq(organizationLocations.organizationId, actor.organizationId!));
  const [location] = await db.select().from(organizationLocations).where(where).orderBy(organizationLocations.createdAt).limit(1);
  if (location && !actor.allLocations && !actor.locationIds.has(location.id)) return undefined;
  return location;
}

async function getSettings(actor: SessionActor): Promise<Response> {
  requirePermission(actor, "tenant.read");
  requireStaff(actor);
  const db = getDb();
  const [[tenant], [organization], location] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1),
    db.select().from(organizations).where(and(eq(organizations.id, actor.organizationId!), eq(organizations.tenantId, actor.tenantId))).limit(1),
    primaryLocation(actor),
  ]);
  if (!tenant || !organization) throw new DomainError("NOT_FOUND", "Business settings not found.", 404);
  const orgSettings = objectValue(organization.settings);
  return json({ item: {
    id: tenant.id, businessName: organization.displayName || tenant.name,
    phone: organization.phone ?? location?.phone ?? "", email: organization.email ?? location?.email ?? "",
    timezone: organization.timezone || tenant.defaultTimezone,
    address: location?.addressLine1 ?? String(orgSettings.businessAddress ?? ""),
    permissions: { canUpdate: actor.permissions.has("tenant.update") },
  } });
}

async function getIndustryConfiguration(actor: SessionActor): Promise<Response> {
  requirePermission(actor, "tenant.read");
  requireStaff(actor);
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
  if (!tenant) throw new DomainError("NOT_FOUND", "Business settings not found.", 404);
  const pack = tenant.industryPackKey ? getIndustryPack(tenant.industryPackKey) : undefined;
  if (!pack) return json({ item: { pack: null, customization: {}, permissions: { canUpdate: actor.permissions.has("tenant.update") } } });
  const settings = objectValue(tenant.settings);
  const customizations = objectValue(settings.industryPackCustomizations);
  let customization;
  try { customization = validateIndustryPackCustomization(pack, customizations[pack.key] ?? {}); }
  catch { customization = {}; }
  return json({ item: { pack: resolveIndustryPack(pack, customization), customization, maturity: getIndustryPackMaturity(pack.key), permissions: { canUpdate: actor.permissions.has("tenant.update") } } });
}

async function patchIndustryConfiguration(request: Request, actor: SessionActor): Promise<Response> {
  requirePermission(actor, "tenant.update");
  requireStaff(actor);
  const body = await readBody(request, z.object({ customization: z.unknown() }));
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    if (!tenant) throw new DomainError("NOT_FOUND", "Business settings not found.", 404);
    const pack = tenant.industryPackKey ? getIndustryPack(tenant.industryPackKey) : undefined;
    if (!pack) throw new DomainError("CONFLICT", "Choose a supported business before configuring its work steps.", 409);
    let customization;
    try { customization = validateIndustryPackCustomization(pack, body.customization); }
    catch (error) { throw new DomainError("VALIDATION_ERROR", error instanceof Error ? error.message : "Review the business workflow settings.", 422); }
    const settings = objectValue(tenant.settings);
    const prior = objectValue(settings.industryPackCustomizations);
    const nextCustomizations = { ...prior, [pack.key]: customization };
    const before = prior[pack.key] && typeof prior[pack.key] === "object" ? prior[pack.key] as Record<string, unknown> : {};
    await tx.update(tenants).set({ settings: { ...settings, industryPackCustomizations: nextCustomizations }, updatedAt: new Date() }).where(eq(tenants.id, actor.tenantId));
    await recordEvent(actor, { type: "tenant.industry_configuration_changed", entityType: "tenant", entityId: tenant.id,
      auditAction: "tenant.industry_configuration_update", before, after: { packKey: pack.key, customization } }, tx);
    return { pack: resolveIndustryPack(pack, customization), customization, maturity: getIndustryPackMaturity(pack.key), permissions: { canUpdate: actor.permissions.has("tenant.update") } };
  });
  return json({ item: result });
}

async function patchSettings(request: Request, actor: SessionActor): Promise<Response> {
  requirePermission(actor, "tenant.update");
  requireStaff(actor);
  const body = await readBody(request, settingsBodySchema);
  if (!Object.values(body).some((value) => value !== undefined)) throw validation("Change at least one business setting.");
  if (body.timezone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: body.timezone }).format(); }
    catch { throw validation("Enter a valid time zone."); }
  }
  const db = getDb();
  const updated = await db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, actor.tenantId)).limit(1);
    const [organization] = await tx.select().from(organizations).where(and(eq(organizations.id, actor.organizationId!), eq(organizations.tenantId, actor.tenantId))).limit(1);
    if (!tenant || !organization) throw new DomainError("NOT_FOUND", "Business settings not found.", 404);
    const location = await primaryLocation(actor, tx);
    const priorSettings = objectValue(organization.settings);
    const before = {
      businessName: organization.displayName || tenant.name, phone: organization.phone ?? location?.phone ?? "",
      email: organization.email ?? location?.email ?? "", timezone: organization.timezone || tenant.defaultTimezone,
      address: location?.addressLine1 ?? String(priorSettings.businessAddress ?? ""),
    };
    const nextName = body.businessName ?? before.businessName;
    const nextPhone = body.phone === undefined ? before.phone : body.phone;
    const nextEmail = body.email === undefined ? before.email : body.email.toLowerCase();
    const nextTimezone = body.timezone ?? before.timezone;
    const nextAddress = body.address ?? before.address;
    const now = new Date();
    await tx.update(organizations).set({
      displayName: nextName, legalName: body.businessName === undefined ? organization.legalName : nextName,
      phone: body.phone === undefined ? organization.phone : nextPhone || null,
      email: body.email === undefined ? organization.email : nextEmail || null,
      timezone: body.timezone ?? organization.timezone,
      settings: { ...priorSettings, businessAddress: nextAddress }, updatedAt: now,
    }).where(and(eq(organizations.id, organization.id), eq(organizations.tenantId, actor.tenantId)));
    await tx.update(tenants).set({ name: nextName, defaultTimezone: nextTimezone, updatedAt: now }).where(eq(tenants.id, actor.tenantId));
    if (location) await tx.update(organizationLocations).set({
      addressLine1: body.address === undefined ? location.addressLine1 : nextAddress || null,
      phone: body.phone === undefined ? location.phone : nextPhone || null,
      email: body.email === undefined ? location.email : nextEmail || null,
      timezone: body.timezone ?? location.timezone, updatedAt: now,
    }).where(and(eq(organizationLocations.id, location.id), eq(organizationLocations.tenantId, actor.tenantId), eq(organizationLocations.organizationId, organization.id)));
    const after = { businessName: nextName, phone: nextPhone, email: nextEmail, timezone: nextTimezone, address: nextAddress };
    await recordEvent(actor, { type: "tenant.settings_updated", entityType: "tenant", entityId: tenant.id, auditAction: "tenant.settings_update", before, after }, tx);
    return after;
  });
  return json({ item: { id: actor.tenantId, ...updated, permissions: { canUpdate: true } } });
}

export async function handleCapabilitySettings(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path[0] === "industry-configuration") {
    if (path.length !== 1) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    if (request.method === "GET") return getIndustryConfiguration(actor);
    if (request.method === "PATCH") return patchIndustryConfiguration(request, actor);
    throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  }
  if (path[0] === "connections") {
    if (path.length === 1 && request.method === "GET") return listConnections(actor);
    return changeConnection(request, path, actor);
  }
  if (path[0] === "automations") return handleAutomations(request, path, actor);
  if (path[0] === "communications") {
    if (path.length !== 1) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    if (request.method === "GET") return listCommunications(request, actor);
    if (request.method === "POST") return queueCommunication(request, actor);
    throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  }
  if (path[0] === "settings") {
    if (path.length !== 1) throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
    if (request.method === "GET") return getSettings(actor);
    if (request.method === "PATCH") return patchSettings(request, actor);
    throw new DomainError("NOT_FOUND", "Endpoint not found.", 404);
  }
  return null;
}
