import { auditEvents, domainEvents } from "@modular-crm/db";
import { getDb } from "../db";
import { type SessionActor } from "./actor";

export async function recordEvent(actor: SessionActor, input: {
  type: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  auditAction?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  locationId?: string | null;
}, writer: Pick<ReturnType<typeof getDb>, "insert"> = getDb()): Promise<void> {
  await writer.insert(domainEvents).values({
    tenantId: actor.tenantId, eventType: input.type, actorType: actor.kind, actorId: actor.userId,
    entityType: input.entityType, entityId: input.entityId, payload: input.payload ?? {},
    organizationId: actor.kind === "staff" ? actor.organizationId : null, locationId: input.locationId ?? null,
  });
  if (input.auditAction) {
    await writer.insert(auditEvents).values({
      tenantId: actor.tenantId, actorType: actor.kind, actorId: actor.userId, action: input.auditAction,
      entityType: input.entityType, entityId: input.entityId,
      beforeData: input.before ?? undefined, afterData: input.after ?? undefined,
    });
  }
}
