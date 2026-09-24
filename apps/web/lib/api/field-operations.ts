import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { fieldOperationReceipts } from "@modular-crm/db";
import { DomainError } from "@modular-crm/domain";
import type { SessionActor } from "./actor";

type FieldTransaction = Parameters<Parameters<ReturnType<typeof import("../db").getDb>["transaction"]>[0]>[0];

export type FieldOperationInput = {
  action: string;
  target: string;
  clientOperationId?: string;
  payload: Record<string, unknown>;
  deviceTimestamp?: Date | null;
  serverReceivedAt?: Date;
  anomalyClass?: string | null;
};

export type FieldOperationClaim = {
  receiptId: string;
  replay: boolean;
  resultKind: string | null;
  resultEntityId: string | null;
  resultRelatedId: string | null;
  resultState: string | null;
  responseStatus: number;
};

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]));
}

function requestHash(input: FieldOperationInput): string {
  const { clientOperationId: _clientOperationId, ...payload } = input.payload;
  const content = canonical({ action: input.action, target: input.target, payload });
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/**
 * Reserves an actor-scoped operation key inside the mutation transaction.
 * A conflicting insert waits for the winner, so effects and receipt commit atomically.
 */
export async function claimFieldOperation(
  tx: FieldTransaction,
  actor: SessionActor,
  input: FieldOperationInput,
): Promise<FieldOperationClaim> {
  const clientOperationId = input.clientOperationId ?? randomUUID();
  const hash = requestHash(input);
  const [created] = await tx.insert(fieldOperationReceipts).values({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    clientOperationId,
    action: input.action,
    requestHash: hash,
    deviceTimestamp: input.deviceTimestamp ?? null,
    serverReceivedAt: input.serverReceivedAt ?? new Date(),
    source: "field_app",
    anomalyClass: input.anomalyClass ?? null,
  }).onConflictDoNothing().returning({
    id: fieldOperationReceipts.id,
    resultKind: fieldOperationReceipts.resultKind,
    resultEntityId: fieldOperationReceipts.resultEntityId,
    resultRelatedId: fieldOperationReceipts.resultRelatedId,
    resultState: fieldOperationReceipts.resultState,
    responseStatus: fieldOperationReceipts.responseStatus,
  });
  if (created) return { ...created, receiptId: created.id, replay: false };

  const [prior] = await tx.select().from(fieldOperationReceipts).where(and(
    eq(fieldOperationReceipts.tenantId, actor.tenantId),
    eq(fieldOperationReceipts.actorId, actor.userId),
    eq(fieldOperationReceipts.clientOperationId, clientOperationId),
  )).for("update").limit(1);
  if (!prior) throw new Error("Field operation receipt disappeared during reservation.");
  if (prior.action !== input.action || prior.requestHash !== hash) {
    throw new DomainError("IDEMPOTENCY_CONFLICT", "This field operation ID was already used for a different action or information.", 409);
  }
  return {
    receiptId: prior.id,
    replay: true,
    resultKind: prior.resultKind,
    resultEntityId: prior.resultEntityId,
    resultRelatedId: prior.resultRelatedId,
    resultState: prior.resultState,
    responseStatus: prior.responseStatus,
  };
}

export async function completeFieldOperation(
  tx: FieldTransaction,
  actor: SessionActor,
  receiptId: string,
  result: { kind: string; entityId: string; relatedId?: string | null; state?: string | null; status?: number },
): Promise<void> {
  const [updated] = await tx.update(fieldOperationReceipts).set({
    resultKind: result.kind,
    resultEntityId: result.entityId,
    resultRelatedId: result.relatedId ?? null,
    resultState: result.state ?? null,
    responseStatus: result.status ?? 200,
    updatedAt: new Date(),
  }).where(and(eq(fieldOperationReceipts.tenantId, actor.tenantId), eq(fieldOperationReceipts.actorId, actor.userId), eq(fieldOperationReceipts.id, receiptId))).returning({ id: fieldOperationReceipts.id });
  if (!updated) throw new Error("Could not complete field operation receipt.");
}

export function fieldTimeAnomaly(deviceTimestamp: Date | null, serverReceivedAt: Date): string {
  if (!deviceTimestamp) return "not_provided";
  const deltaMs = deviceTimestamp.getTime() - serverReceivedAt.getTime();
  if (deltaMs > 0) return "device_clock_ahead";
  if (deltaMs < -24 * 60 * 60_000) return "long_offline_delay";
  if (deltaMs < -10 * 60_000) return "offline_delay";
  return "none";
}

/** Device clocks ahead of receipt time are never allowed to move work into the future. */
export function fieldEffectiveTime(deviceTimestamp: Date | null, serverReceivedAt: Date): Date {
  if (!deviceTimestamp || deviceTimestamp.getTime() > serverReceivedAt.getTime()) return serverReceivedAt;
  return deviceTimestamp;
}
