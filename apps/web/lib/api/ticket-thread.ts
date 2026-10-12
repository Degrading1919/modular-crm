import { and, asc, eq } from "drizzle-orm";
import { ticketComments, tickets, ticketStatusDefinitions } from "@modular-crm/db";
import { assertTransition, DomainError, requirePermission } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";
import { requireStaff, type SessionActor } from "./actor";
import { assertTicketAccess } from "./records";
import { recordEvent } from "./events";
import { json, readBody } from "./http";
import { normalized } from "./sql";

export async function handleTicketThread(request: Request, path: string[], actor: SessionActor): Promise<Response | null> {
  if (path.length !== 3 || path[0] !== "tickets" || path[2] !== "thread") return null;
  requireStaff(actor); requirePermission(actor, "tickets.read");
  const id = z.uuid().parse(path[1]); await assertTicketAccess(actor, id);
  if (request.method === "GET") return json({ items: normalized(await getDb().select().from(ticketComments).where(and(eq(ticketComments.tenantId, actor.tenantId), eq(ticketComments.ticketId, id))).orderBy(asc(ticketComments.createdAt), asc(ticketComments.id))) });
  if (request.method !== "POST") return null;
  const input = await readBody(request, z.object({ body: z.string().trim().min(1).max(10_000).optional(), visibility: z.enum(["internal", "customer"]).default("customer"), commentId: z.uuid().optional(), close: z.boolean().default(false) }).strict().refine(value => !!value.body || value.close, "Write a reply or close the ticket."));
  if (input.body) requirePermission(actor, "tickets.update");
  if (input.close) requirePermission(actor, "tickets.close");
  await getDb().transaction(async tx => {
    const [ticket] = await tx.select().from(tickets).where(and(eq(tickets.tenantId, actor.tenantId), eq(tickets.id, id))).for("update");
    if (!ticket) throw new DomainError("NOT_FOUND", "Ticket not found.", 404);
    if (input.body) {
      if (!input.commentId) throw new DomainError("VALIDATION_ERROR", "Provide a reply retry key.", 422);
      if (input.visibility === "customer" && !ticket.customerVisible) throw new DomainError("VALIDATION_ERROR", "This ticket is internal. Save an office note instead.", 422);
      const [prior] = await tx.select().from(ticketComments).where(eq(ticketComments.id, input.commentId));
      if (prior && (prior.tenantId !== actor.tenantId || prior.ticketId !== id || prior.body !== input.body || prior.visibility !== input.visibility)) throw new DomainError("CONFLICT", "This reply retry key was already used.", 409);
      if (!prior) {
        await tx.insert(ticketComments).values({ id: input.commentId, tenantId: actor.tenantId, ticketId: id, body: input.body, visibility: input.visibility, actorType: "staff", actorId: actor.userId });
        await recordEvent(actor, { type: "ticket.replied", entityType: "ticket", entityId: id, auditAction: "ticket.reply", payload: { commentId: input.commentId, visibility: input.visibility } }, tx);
      }
    }
    if (input.close) {
      let [status] = await tx.select().from(ticketStatusDefinitions).where(and(eq(ticketStatusDefinitions.tenantId, actor.tenantId), eq(ticketStatusDefinitions.id, ticket.statusDefinitionId)));
      if (!status) throw new DomainError("CONFLICT", "Ticket status is unavailable. Refresh before closing it.", 409);
      for (const next of status.normalizedCategory === "closed" ? [] : status.normalizedCategory === "resolved" ? ["closed"] : ["resolved", "closed"]) {
        assertTransition("ticket", status!.normalizedCategory, next);
        const [definition] = await tx.insert(ticketStatusDefinitions).values({ tenantId: actor.tenantId, key: next, name: next === "closed" ? "Closed" : "Resolved", normalizedCategory: next }).onConflictDoUpdate({ target: [ticketStatusDefinitions.tenantId, ticketStatusDefinitions.key], set: { active: true } }).returning();
        await tx.update(tickets).set({ statusDefinitionId: definition!.id, resolvedAt: ticket.resolvedAt ?? new Date(), ...(next === "closed" ? { closedAt: new Date() } : {}), updatedAt: new Date() }).where(and(eq(tickets.tenantId, actor.tenantId), eq(tickets.id, id)));
        await recordEvent(actor, { type: `ticket.${next}`, entityType: "ticket", entityId: id, auditAction: `ticket.${next}`, before: { status: status!.key }, after: { status: next } }, tx);
        status = definition;
      }
    }
  });
  return json({ saved: true, message: input.body ? input.visibility === "customer" ? "Reply saved in the customer portal. No email notification was sent." : "Office note saved. No customer notification was sent." : "Ticket closed. No email notification was sent." });
}
