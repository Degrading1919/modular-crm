import { and, eq } from "drizzle-orm";
import { estimateItems, type Database } from "@modular-crm/db";
import { DomainError, priceDocument, type DocumentPricing } from "@modular-crm/domain";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function approvedPricing(tx: Tx, tenantId: string, revision: {id:string;snapshot:Record<string,unknown>;subtotalMinor:bigint;discountMinor:bigint;taxMinor:bigint;totalMinor:bigint}, acceptedOptionalIds?: string[]): Promise<DocumentPricing> {
  const lines = await tx.select().from(estimateItems).where(and(eq(estimateItems.tenantId,tenantId),eq(estimateItems.estimateRevisionId,revision.id))).orderBy(estimateItems.sortOrder);
  const optional = lines.filter(line => line.metadata.optional === true);
  if (optional.length && acceptedOptionalIds === undefined) throw new DomainError("VALIDATION_ERROR","Choose which optional add-ons to include before approving.",422);
  const ids = new Set(acceptedOptionalIds ?? []);
  if (ids.size !== (acceptedOptionalIds?.length ?? 0) || [...ids].some(id => !optional.some(line => line.id === id))) throw new DomainError("VALIDATION_ERROR","Choose add-ons from this estimate version.",422);
  const pricing = revision.snapshot.pricingSnapshot as Partial<DocumentPricing> | undefined;
  // Older accepted quotes may contain tax not produced by the current calculator.
  // Retain those exact existing amounts rather than silently repricing history.
  if (pricing?.version !== 1) return { version:1,taxRateBasisPoints:0,discount:{type:"amount",value:0},subtotalMinor:Number(revision.subtotalMinor),discountMinor:Number(revision.discountMinor),taxMinor:Number(revision.taxMinor),totalMinor:Number(revision.totalMinor),items:lines.map((l,index)=>({description:l.description,quantity:l.quantity,unitAmountMinor:Number(l.unitAmountMinor),serviceId:l.serviceId,discountMinor:Number(l.discountMinor),documentDiscountMinor:0,taxMinor:Number(l.taxMinor),subtotalMinor:Number(l.totalMinor+l.discountMinor-l.taxMinor),totalMinor:Number(l.totalMinor),sortOrder:index})) };
  return priceDocument(lines.filter(line => line.metadata.optional !== true || ids.has(line.id)).map(line => ({description:line.description,quantity:line.quantity,unitAmountMinor:Number(line.unitAmountMinor),discountMinor:Number(line.metadata.lineDiscountMinor ?? line.discountMinor),taxable:line.metadata.taxable === true,serviceId:line.serviceId, charge: line.metadata.charge === "once" ? "once" : "every_visit"})),pricing.taxRateBasisPoints ?? 0,pricing.discount);
}
