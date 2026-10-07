import { and, eq } from "drizzle-orm";
import { organizations, services } from "@modular-crm/db";
import { DomainError, priceDocument, type DocumentLineInput } from "@modular-crm/domain";
import { z } from "zod";
import { getDb } from "../db";

export const lineSchema = z.object({ description: z.string().trim().min(1).max(500), quantity: z.string().regex(/^\d{1,10}(\.\d{1,4})?$/), unitAmountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), discountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), taxable: z.boolean().default(false), optional: z.boolean().default(false), serviceId: z.uuid().nullable().optional() }).strict();
export const pricingFields = { lines: z.array(lineSchema).min(1).max(100).optional(), taxRateBasisPoints: z.number().int().min(0).max(10000).optional(), discount: z.object({ type: z.enum(["amount","percent"]), value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().optional() };
type PricingBody = { lines?: DocumentLineInput[]; taxRateBasisPoints?: number; discount?: {type:"amount"|"percent";value:number}; totalCents?: number; title?: string; description?: string; serviceId?: string | null };
type Reader = Pick<ReturnType<typeof getDb>, "select">;
export async function documentPricing(db: Reader, tenantId: string, organizationId: string, body: PricingBody, estimate = false) {
  const lines = body.lines ?? [{ description: body.title ?? body.description ?? "Service", quantity: "1", unitAmountMinor: body.totalCents ?? 0, serviceId: body.serviceId, taxable: false }];
  if (!estimate && lines.some(line => line.optional)) throw new DomainError("VALIDATION_ERROR","Optional add-ons belong on an estimate, not an invoice.",422);
  for (const line of lines) if (line.serviceId) {
    const [service] = await db.select({ id: services.id }).from(services).where(and(eq(services.tenantId,tenantId),eq(services.organizationId,organizationId),eq(services.id,line.serviceId),eq(services.active,true))).limit(1);
    if (!service) throw new DomainError("NOT_FOUND","Service not found in this business.",404);
  }
  const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(and(eq(organizations.tenantId,tenantId),eq(organizations.id,organizationId))).limit(1);
  const defaultTax = Number((org?.settings as Record<string,unknown>)?.defaultTaxRateBasisPoints ?? 0);
  // Legacy single-total requests retain their historical untaxed meaning.
  return priceDocument(lines,body.lines ? body.taxRateBasisPoints ?? defaultTax : 0,body.discount);
}
export function storedLine(line: ReturnType<typeof priceDocument>["items"][number]) {
  return { serviceId: line.serviceId ?? null, description: line.description,quantity: line.quantity,unitAmountMinor: BigInt(line.unitAmountMinor),discountMinor: BigInt(line.discountMinor + line.documentDiscountMinor),taxMinor: BigInt(line.taxMinor),totalMinor: BigInt(line.totalMinor),sortOrder: line.sortOrder,metadata: { taxable: !!line.taxable, optional: !!line.optional, lineDiscountMinor: line.discountMinor } };
}
