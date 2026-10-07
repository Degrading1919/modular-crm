import { and, eq } from "drizzle-orm";
import { tenants } from "@modular-crm/db";
import { getIndustryPack, NEUTRAL_SERVICE_PACK, packFieldValues, type IndustryPack, type PackField } from "@modular-crm/industry-packs";
import { z } from "zod";
import { DomainError } from "@modular-crm/domain";
import { getDb } from "../db";
import { encryptServiceAccessInstructions } from "./service-access";

export async function tenantIndustryPack(tenantId: string): Promise<IndustryPack> {
  const [tenant] = await getDb().select({ key: tenants.industryPackKey }).from(tenants).where(and(eq(tenants.id, tenantId), eq(tenants.status, "active"))).limit(1);
  const pack = tenant ? tenant.key ? getIndustryPack(tenant.key) : NEUTRAL_SERVICE_PACK : undefined;
  if (!pack) throw new DomainError("VALIDATION_ERROR", "Business service details are unavailable. Contact the office.", 422);
  return pack;
}

export function packFieldSchema(field: PackField, partial = false): z.ZodType {
  let schema: z.ZodType;
  switch (field.type) {
    case "number": schema = z.number().finite().min(0).max(1_000_000); break;
    case "boolean": schema = z.boolean(); break;
    case "date": schema = field.required ? z.iso.date() : z.union([z.iso.date(), z.literal("")]); break;
    case "enum": schema = z.enum(field.options as [string, ...string[]]); break;
    default: schema = z.string().max(field.sensitive ? 2000 : 1000); break;
  }
  if (field.required && field.type === "text") schema = z.string().trim().min(1).max(1000);
  if (!partial && field.defaultValue !== undefined) schema = schema.default(field.defaultValue);
  else if (partial || !field.required) schema = schema.optional();
  return schema;
}

export function fieldsSchema(fields: readonly PackField[], partial = false) {
  return z.object(Object.fromEntries(fields.map(field => [field.key, packFieldSchema(field, partial)]))).strict();
}

export function packInputSchema(pack: IndustryPack, partial = false) {
  const choices = pack.assets.map(asset => z.object({ assetTypeKey: z.literal(asset.key), name: z.string().trim().min(1).max(100), customFields: fieldsSchema(asset.fields.filter(field => field.key !== "name" && field.signupVisible), partial).prefault({}) }).strict());
  const assetSchema = choices.length === 1 ? choices[0]! : choices.length ? z.union(choices as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]) : z.never();
  let locationSchema = fieldsSchema(pack.locationFields.filter(field => field.signupVisible), partial);
  const quantityField = pack.locationFields.find(field => field.key === pack.intake?.quantity.locationField);
  if (quantityField) {
    const count = z.number().int().min(1).max(1_000_000);
    locationSchema = locationSchema.extend({ [quantityField.key]: partial ? count.optional() : quantityField.defaultValue !== undefined ? count.default(Number(quantityField.defaultValue)) : count });
  }
  return { assets: z.array(assetSchema).min(!partial && pack.intake?.quantity.assetTypeKey ? 1 : 0).max(20).prefault([]), locationFields: locationSchema.prefault({}), quantity: z.number().int().min(1).max(20).optional() };
}

/** Legacy names and nested shapes belong to the selected pack, never to shared routes. */
export function normalizePackInput(pack: IndustryPack, raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const input = { ...raw as Record<string, unknown> };
  const legacy = pack.intake?.legacy;
  if (!legacy) return input;
  if (input[legacy.assetCollection] !== undefined) {
    if (input.assets !== undefined) throw new DomainError("VALIDATION_ERROR", "Send only one set of service details.", 422);
    const definition = pack.assets[0]!;
    const values = z.array(fieldsSchema(definition.fields.filter(field => field.signupVisible))).min(1).max(20).parse(input[legacy.assetCollection]);
    input.assets = values.map(value => { const { name, ...customFields } = value; return { assetTypeKey: definition.key, name, customFields }; });
    delete input[legacy.assetCollection];
  }
  const locationFields = { ...(input.locationFields as Record<string, unknown> ?? {}) };
  if (input[legacy.locationObject] !== undefined) {
    if (input.locationFields !== undefined) throw new DomainError("VALIDATION_ERROR", "Send only one set of property details.", 422);
    const schema = z.object(Object.fromEntries(Object.entries(legacy.locationFields).map(([alias, key]) => [alias, packFieldSchema(pack.locationFields.find(field => field.key === key)!)]))).strict();
    const values = schema.parse(input[legacy.locationObject]);
    for (const [alias, key] of Object.entries(legacy.locationFields)) if (values[alias] !== undefined) locationFields[key] = values[alias];
    delete input[legacy.locationObject];
  }
  for (const [alias, key] of Object.entries(legacy.quoteFields)) if (input[alias] !== undefined) {
    if (locationFields[key] !== undefined) throw new DomainError("VALIDATION_ERROR", "Send only one value for each property detail.", 422);
    locationFields[key] = input[alias]; delete input[alias];
  }
  if (input[legacy.countField] !== undefined) { input.quantity = input[legacy.countField]; delete input[legacy.countField]; }
  input.locationFields = locationFields;
  return input;
}

export type ServiceAssetInput = { assetTypeKey: string; name: string; customFields: Record<string, unknown> };
export type ServiceDetailsInput = { assets: ServiceAssetInput[]; locationFields: Record<string, unknown>; quantity?: number };

export function storePackFields(fields: readonly PackField[], values: Record<string, unknown>) {
  const plain: Record<string, unknown> = {};
  const privateLines: string[] = [];
  for (const field of fields) {
    const value = values[field.key] ?? field.defaultValue;
    if (value === undefined || value === "") continue;
    if (field.sensitive) privateLines.push(`${field.label}: ${String(value)}`);
    else if (field.key !== "name") plain[field.storageKey ?? field.key] = value;
  }
  return { customFields: plain, accessInstructionsEncrypted: encryptServiceAccessInstructions(privateLines.join("\n")) };
}

export function safePackDetails(pack: IndustryPack, input: ServiceDetailsInput) {
  return {
    assets: input.assets.map(asset => ({ ...asset, customFields: storePackFields(pack.assets.find(def => def.key === asset.assetTypeKey)!.fields, asset.customFields).customFields })),
    locationFields: storePackFields(pack.locationFields, input.locationFields).customFields,
  };
}

export function assetView(pack: IndustryPack, row: { id: unknown; name: string; assetTypeKey: string; customFields: Record<string, unknown> }, portal = false) {
  const definition = pack.assets.find(asset => asset.key === row.assetTypeKey);
  const fields = (definition?.fields ?? []).filter(field => !field.sensitive && (!portal || field.customerVisible));
  const name = !portal || fields.some(field => field.key === "name") ? row.name : "Service item";
  return { id: row.id, name, assetTypeKey: row.assetTypeKey, label: definition?.label ?? "Service item", pluralLabel: definition?.pluralLabel ?? "Service details", fields, customFields: packFieldValues(fields, row.customFields, name) };
}

export function packImportFields(pack: IndustryPack) {
  return [
    ...pack.locationFields.map(field => ({ key: `location.${field.key}`, label: field.label, field, assetTypeKey: null as string | null })),
    ...pack.assets.flatMap(asset => asset.fields.map(field => ({ key: `asset.${asset.key}.${field.key}`, label: `${asset.label}: ${field.label}`, field, assetTypeKey: asset.key }))),
  ];
}

export function packImportAliases(pack: IndustryPack): Record<string, readonly string[]> {
  return Object.fromEntries(packImportFields(pack).map(item => [item.key, [item.label, ...(pack.importAliases?.[item.key] ?? [])]]));
}

/** Parse imported values without echoing rejected values into errors or history. */
export function importedPackDetails(pack: IndustryPack, values: Record<string, string>): ServiceDetailsInput {
  const locationFields: Record<string, unknown> = {};
  const byAsset = new Map<string, Record<string, unknown>>();
  for (const item of packImportFields(pack)) {
    const raw = values[item.key];
    if (!raw) continue;
    let value: unknown = raw;
    if (item.field.type === "number") value = Number(raw);
    if (item.field.type === "boolean") value = /^(true|yes|1)$/i.test(raw) ? true : /^(false|no|0)$/i.test(raw) ? false : raw;
    const parsed = (item.key === `location.${pack.intake?.quantity.locationField}` ? z.number().int().min(1).max(1_000_000) : packFieldSchema(item.field)).safeParse(value);
    if (!parsed.success) throw new DomainError("VALIDATION_ERROR", `Check the imported ${item.label} field.`, 422);
    if (item.assetTypeKey) {
      const fields = byAsset.get(item.assetTypeKey) ?? {};
      fields[item.field.key] = parsed.data; byAsset.set(item.assetTypeKey, fields);
    } else locationFields[item.field.key] = parsed.data;
  }
  const assets = [...byAsset].map(([assetTypeKey, fields]) => {
    const definition = pack.assets.find(asset => asset.key === assetTypeKey)!;
    const parsed = fieldsSchema(definition.fields).safeParse(fields);
    if (!parsed.success || typeof parsed.data.name !== "string" || !parsed.data.name.trim()) throw new DomainError("VALIDATION_ERROR", `Check the imported ${definition.label} fields, including its name.`, 422);
    const { name, ...customFields } = parsed.data;
    return { assetTypeKey, name, customFields };
  });
  return { assets, locationFields };
}
