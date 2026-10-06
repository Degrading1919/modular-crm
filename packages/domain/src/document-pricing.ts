import { DomainError } from "./errors.ts";

export type DocumentLineInput = { description: string; quantity: string; unitAmountMinor: number; discountMinor?: number; taxable?: boolean; optional?: boolean; serviceId?: string | null; charge?: "once" | "every_visit" };
export type DocumentDiscount = { type: "amount" | "percent"; value: number };
export type PricedLine = DocumentLineInput & { subtotalMinor: number; discountMinor: number; documentDiscountMinor: number; taxMinor: number; totalMinor: number; sortOrder: number };
export type DocumentPricing = { version: 1; taxRateBasisPoints: number; discount: DocumentDiscount; items: PricedLine[]; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };

/** Partition accepted prices without repricing their frozen discounts or tax. */
export function documentCharges(pricing: DocumentPricing, charge: "once" | "every_visit"): DocumentPricing {
  const items = pricing.items.filter(line => (line.charge ?? "every_visit") === charge);
  return frozenDocument(items, pricing.taxRateBasisPoints);
}

/** Combining finished work copies each visit's exact recorded amounts. */
export function frozenDocument(items: PricedLine[], taxRateBasisPoints = 0): DocumentPricing {
  const sum = (field: "subtotalMinor" | "taxMinor" | "totalMinor") => safe(items.reduce((total, line) => total + BigInt(line[field]), 0n));
  return { version: 1, taxRateBasisPoints, discount: { type: "amount", value: 0 }, items: items.map((line, sortOrder) => ({ ...line, discountMinor: line.discountMinor + line.documentDiscountMinor, documentDiscountMinor: 0, sortOrder })), subtotalMinor: sum("subtotalMinor"), discountMinor: safe(items.reduce((total, line) => total + BigInt(line.discountMinor + line.documentDiscountMinor), 0n)), taxMinor: sum("taxMinor"), totalMinor: sum("totalMinor") };
}
const invalid = (message: string): never => { throw new DomainError("VALIDATION_ERROR", message, 422); };
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
const safe = (value: bigint): number => value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : invalid("This amount is too large. Reduce the quantity or price.");
const halfUp = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (2n * denominator);

/** Integer arithmetic throughout. Quantity has at most four decimal places;
 * extended prices and percentages round half-up. Tax rounds once per document,
 * after discounts. Cumulative allocation preserves exact totals in line order. */
export function priceDocument(lines: DocumentLineInput[], taxRateBasisPoints = 0, discount: DocumentDiscount = { type: "amount", value: 0 }): DocumentPricing {
  if (!lines.length || lines.length > 100) invalid("Add between one and 100 lines.");
  if (!integer(taxRateBasisPoints) || taxRateBasisPoints > 10000) invalid("Enter a tax rate between 0 and 100 percent.");
  if (!["amount", "percent"].includes(discount.type) || !integer(discount.value) || discount.type === "percent" && discount.value > 10000) invalid("Enter a valid discount.");
  const items = lines.map((line, sortOrder) => {
    if (!line.description.trim() || line.description.length > 500) invalid("Enter a description for every line.");
    if (!/^\d{1,10}(\.\d{1,4})?$/.test(line.quantity)) invalid("Enter a positive quantity with up to four decimal places.");
    const [whole, fraction = ""] = line.quantity.split(".");
    const quantity = BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0"));
    if (!quantity || !integer(line.unitAmountMinor) || !integer(line.discountMinor ?? 0)) invalid("Enter a positive quantity and a valid price and discount.");
    const subtotalMinor = safe(halfUp(quantity * BigInt(line.unitAmountMinor), 10000n));
    if ((line.discountMinor ?? 0) > subtotalMinor) invalid("A line discount cannot exceed its price.");
    return { ...line, description: line.description.trim(), subtotalMinor, discountMinor: line.discountMinor ?? 0, documentDiscountMinor: 0, taxMinor: 0, totalMinor: 0, sortOrder };
  });
  const subtotal = items.reduce((sum, item) => sum + BigInt(item.subtotalMinor), 0n);
  const lineDiscount = items.reduce((sum, item) => sum + BigInt(item.discountMinor), 0n);
  const net = subtotal - lineDiscount;
  const documentDiscount = discount.type === "amount" ? BigInt(discount.value) : halfUp(net * BigInt(discount.value), 10000n);
  if (documentDiscount > net) invalid("The discount cannot exceed the document subtotal.");
  let cumulativeNet = 0n, allocatedDiscount = 0n, taxable = 0n, allocatedTax = 0n;
  for (const item of items) {
    cumulativeNet += BigInt(item.subtotalMinor - item.discountMinor);
    const nextDiscount = net ? documentDiscount * cumulativeNet / net : 0n;
    item.documentDiscountMinor = safe(nextDiscount - allocatedDiscount); allocatedDiscount = nextDiscount;
    const basis = BigInt(item.subtotalMinor - item.discountMinor - item.documentDiscountMinor);
    if (item.taxable) taxable += basis;
    const nextTax = halfUp(taxable * BigInt(taxRateBasisPoints), 10000n);
    item.taxMinor = safe(nextTax - allocatedTax); allocatedTax = nextTax;
    item.totalMinor = safe(basis + BigInt(item.taxMinor));
  }
  return { version: 1, taxRateBasisPoints, discount, items, subtotalMinor: safe(subtotal), discountMinor: safe(lineDiscount + documentDiscount), taxMinor: safe(allocatedTax), totalMinor: safe(net - documentDiscount + allocatedTax) };
}
