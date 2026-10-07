import { describe, expect, it, vi } from "vitest";
import { HOUSE_CLEANING_PACK, PET_WASTE_REMOVAL_PACK, packFieldValues, packQuantity, validateIndustryPack, type IndustryPack } from "@modular-crm/industry-packs";

vi.mock("../lib/db.ts", () => ({ getDb: vi.fn() }));
process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { publicPackSchema } = await import("../lib/api/public-site.ts");
const { assetView, fieldsSchema, importedPackDetails, packImportAliases, privatePackFingerprints, savedSignupDetails, safePackDetails, storePackFields } = await import("../lib/api/pack-fields.ts");
const { decryptServiceAccessInstructions } = await import("../lib/api/service-access.ts");
const { apiError } = await import("../lib/api/http.ts");

const base = { slug: "tidy-home", address: "12 Birch Street", zip: "30909", serviceId: "recurring-cleaning", frequency: "weekly" };
const details = { assets: [{ assetTypeKey: "room", name: "Kitchen", customFields: { floor_surface: "tile", care_notes: "Soft cloth" } }], locationFields: { room_count: 3, home_type: "house", supplies_provided: true, first_visit: "2026-10-08", entry_instructions: "private-entry-7812" } };

describe("pack-selected service details", () => {
  it("rejects customer edits to media even if a future pack marks it editable", () => {
    const media = { key: "photo", label: "Photo", type: "media" as const, customerVisible: true, customerEditable: true };
    expect(fieldsSchema([media], true, true).safeParse({ photo: "anything" }).success).toBe(false);
    expect(fieldsSchema([media], true, true).parse({})).toEqual({});
    const pack = { ...PET_WASTE_REMOVAL_PACK, assets: [{ ...PET_WASTE_REMOVAL_PACK.assets[0]!, fields: [media] }] };
    expect(assetView(pack, { id: "item", name: "Item", assetTypeKey: "pet", customFields: { photo: "existing-reference" } }, true).fields[0]!.customerEditable).toBe(false);
    expect(PET_WASTE_REMOVAL_PACK.assets[0]!.fields.find(field => field.key === "photo")!.customerEditable).not.toBe(true);
  });
  it("uses tenant/field-separated keyed private evidence for both location and asset fields", () => {
    const pack: IndustryPack = { ...HOUSE_CLEANING_PACK, assets: [{ ...HOUSE_CLEANING_PACK.assets[0]!, fields: [{ key: "private_note", label: "Private note", type: "text", sensitive: true }] }] };
    const input = { assets: [{ assetTypeKey: "room", name: "Room", customFields: { private_note: "1234" } }], locationFields: { entry_instructions: "1234" } };
    const first = privatePackFingerprints(pack, input, "tenant-one");
    expect(first).toEqual(privatePackFingerprints(pack, input, "tenant-one"));
    expect(first["location.entry_instructions"]).not.toBe(first["asset.0.room.private_note"]);
    expect(first).not.toEqual(privatePackFingerprints(pack, input, "tenant-two"));
    expect(JSON.stringify(first)).not.toContain("1234");
  });
  it("maps older signup leads through pack legacy names without adding form defaults or private plaintext", () => {
    expect(savedSignupDetails(PET_WASTE_REMOVAL_PACK, { pets: [{ name: "Legacy", species: "dog" }], yardSize: "large" })).toEqual({ assets: [{ assetTypeKey: "pet", name: "Legacy", customFields: { species: "dog" } }], customFields: { yardSize: "large" } });
    expect(savedSignupDetails(HOUSE_CLEANING_PACK, { assets: [{ assetTypeKey: "room", name: "Room", customFields: { floor_surface: "tile", unknown: "discard" } }], locationFields: { room_count: 4, entry_instructions: "discard-private" } }).customFields).toEqual({ room_count: 4 });
  });
  it("validates both packs and uses declared numeric quantity rather than item count", () => {
    for (const pack of [HOUSE_CLEANING_PACK, PET_WASTE_REMOVAL_PACK]) expect(() => validateIndustryPack(pack)).not.toThrow();
    const parsed = publicPackSchema(HOUSE_CLEANING_PACK, "quote").parse({ ...base, ...details }) as unknown as typeof details;
    expect(parsed.locationFields).toEqual(details.locationFields);
    expect(packQuantity(HOUSE_CLEANING_PACK, parsed.assets, parsed.locationFields).quantity).toBe(3);
    expect(() => validateIndustryPack({ ...HOUSE_CLEANING_PACK, intake: { quantity: { locationField: "entry_instructions" } } })).toThrow("non-sensitive numeric");
  });
  it.each([
    { ...base, ...details, unknown: "value" },
    { ...base, ...details, pets: [{ name: "wrong pack" }] },
    { ...base, ...details, locationFields: { ...details.locationFields, unknown: 1 } },
    { ...base, ...details, assets: [{ ...details.assets[0], customFields: { hidden: "value" } }] },
    { ...base, ...details, assets: [{ assetTypeKey: "pet", name: "wrong type", customFields: {} }] },
    { ...base, ...details, locationFields: { supplies_provided: "yes" } },
    { ...base, ...details, locationFields: { first_visit: "not-a-date" } },
    { ...base, ...details, locationFields: { home_type: "unknown" } },
    { ...base, ...details, locationFields: { room_count: 0 } },
    { ...base, ...details, locationFields: { room_count: 1.5 } },
  ])("rejects wrong types, cross-pack fields, and unknown fields", input => {
    expect(publicPackSchema(HOUSE_CLEANING_PACK, "quote").safeParse(input).success).toBe(false);
  });
  it("keeps legacy signup and quote shapes equivalent through pack compatibility data", () => {
    const legacy = { slug: "happy-yards", address: "12 Oak Lane", zip: "30909", serviceId: "recurring-cleanup", frequency: "weekly", petCount: 2, yardSize: "medium" };
    const quote = publicPackSchema(PET_WASTE_REMOVAL_PACK, "quote").parse(legacy) as { quantity: number; locationFields: Record<string, unknown> };
    expect(quote.quantity).toBe(2); expect(quote.locationFields).toEqual({ yard_size: "medium" });
    const core = { slug: "happy-yards", address: "12 Oak Lane", zip: "30909", contact: { name: "Alex Carter", email: "carter@example.test", phone: "555-010101" }, service: { id: "recurring-cleanup", frequency: "weekly" }, termsAccepted: true, idempotencyKey: "compatibility-test" };
    const old = publicPackSchema(PET_WASTE_REMOVAL_PACK, "signup").parse({ ...core, pets: [{ name: "Buddy", size: "medium" }], yard: { size: "medium", gateCode: "1234", accessNotes: "Side entrance" } });
    const current = publicPackSchema(PET_WASTE_REMOVAL_PACK, "signup").parse({ ...core, assets: [{ assetTypeKey: "pet", name: "Buddy", customFields: { size: "medium" } }], locationFields: { yard_size: "medium", gate_code: "1234", access_notes: "Side entrance" } });
    expect(current).toEqual(old);
    expect(publicPackSchema(PET_WASTE_REMOVAL_PACK, "signup").safeParse({ ...core, pets: [{ name: "Buddy", unknown: true }] }).success).toBe(false);
  });
  it("encrypts sensitive values while leaving safe fields usable and errors free of private input", async () => {
    const stored = storePackFields(HOUSE_CLEANING_PACK.locationFields, details.locationFields);
    expect(stored.customFields).not.toHaveProperty("entry_instructions");
    expect(stored.accessInstructionsEncrypted).toMatch(/^v1:/);
    expect(JSON.stringify(stored)).not.toContain("private-entry-7812");
    expect(decryptServiceAccessInstructions(stored.accessInstructionsEncrypted)).toContain("private-entry-7812");
    expect(JSON.stringify(safePackDetails(HOUSE_CLEANING_PACK, details))).not.toContain("private-entry-7812");
    const bad = publicPackSchema(HOUSE_CLEANING_PACK, "quote").safeParse({ ...base, ...details, locationFields: { entry_instructions: "private-entry-7812", supplies_provided: "private-entry-7812" } });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(await apiError(bad.error).text()).not.toContain("private-entry-7812");
  });
  it("resolves stored legacy fields without rewriting them and filters hidden portal fields", () => {
    const stored = { species: "dog", size: "large", activeAtLocation: true, safetyFlag: true, safety_notes: "private" };
    const before = structuredClone(stored);
    const view = assetView(PET_WASTE_REMOVAL_PACK, { id: "1", name: "Buddy", assetTypeKey: "pet", customFields: stored }, true);
    expect(view.name).toBe("Buddy"); expect(view.customFields).toMatchObject({ name: "Buddy", species: "dog", size: "large", active_at_location: true });
    expect(view.customFields).not.toHaveProperty("safetyFlag"); expect(view.customFields).not.toHaveProperty("safety_notes");
    expect(stored).toEqual(before);
    const hiddenNamePack = { ...HOUSE_CLEANING_PACK, assets: HOUSE_CLEANING_PACK.assets.map(asset => ({ ...asset, fields: asset.fields.map(field => field.key === "name" ? { ...field, customerVisible: false, customerEditable: false } : field) })) };
    expect(assetView(hiddenNamePack, { id: "2", name: "Hidden room", assetTypeKey: "room", customFields: {} }, true).name).toBe("Service item");
    expect(packFieldValues(PET_WASTE_REMOVAL_PACK.locationFields, { yardSize: "medium" })).toMatchObject({ yard_size: "medium" });
  });
  it("imports aliases and typed fields from either pack, with no implicit industry aliases", () => {
    expect(packImportAliases(HOUSE_CLEANING_PACK)["asset.room.name"]).toContain("room name");
    const parsed = importedPackDetails(HOUSE_CLEANING_PACK, { "asset.room.name": "Kitchen", "asset.room.floor_surface": "tile", "location.room_count": "3", "location.supplies_provided": "yes", "location.entry_instructions": "private" });
    expect(parsed.assets[0]).toMatchObject({ name: "Kitchen", customFields: { floor_surface: "tile" } });
    expect(parsed.locationFields).toMatchObject({ room_count: 3, supplies_provided: true });
    expect(() => importedPackDetails(HOUSE_CLEANING_PACK, { "location.supplies_provided": "private-invalid" })).toThrow("Check the imported");
    expect(() => importedPackDetails(HOUSE_CLEANING_PACK, { "location.room_count": "0" })).toThrow("Check the imported");
    const sensitiveQuantity: IndustryPack = { ...HOUSE_CLEANING_PACK, intake: { quantity: { locationField: "entry_instructions" } } };
    expect(() => validateIndustryPack(sensitiveQuantity)).toThrow();
  });
  it("reads only recorded values, including legacy string warnings, without inventing defaults", () => {
    const row = { id: "max", name: "Max", assetTypeKey: "pet", customFields: { species: "dog", safetyFlag: "Reactive near gate" } };
    const staff = assetView(PET_WASTE_REMOVAL_PACK, row);
    expect(staff.customFields).toEqual({ name: "Max", species: "dog", safety_flag: "Reactive near gate" });
    expect(staff.fields.find(field => field.key === "safety_flag")).toMatchObject({ storageKey: "safetyFlag", displayAs: "warning" });
    expect(assetView(PET_WASTE_REMOVAL_PACK, row, true).customFields).toEqual({ name: "Max", species: "dog" });
    for (const pack of [PET_WASTE_REMOVAL_PACK, HOUSE_CLEANING_PACK]) {
      expect(packFieldValues(pack.locationFields, {})).toEqual({});
      for (const asset of pack.assets) expect(packFieldValues(asset.fields, {})).toEqual({});
    }
    expect(packFieldValues(HOUSE_CLEANING_PACK.locationFields, { supplies_provided: false, room_count: 0 })).toEqual({ supplies_provided: false, room_count: 0 });
    const input = publicPackSchema(PET_WASTE_REMOVAL_PACK, "signup").parse({ slug: "happy-yards", address: "12 Oak Lane", zip: "30909", contact: { name: "Alex", email: "alex@example.test", phone: "555-010101" }, service: { id: "recurring-cleanup", frequency: "weekly" }, assets: [{ assetTypeKey: "pet", name: "New item", customFields: {} }], termsAccepted: true, idempotencyKey: "default-input-test" }) as { assets: { customFields: Record<string, unknown> }[] };
    expect(input.assets[0]!.customFields.size).toBe("medium");
  });
  it("validates skip alias targets and warning metadata within the pack", () => {
    expect(() => validateIndustryPack({ ...PET_WASTE_REMOVAL_PACK, noncompletionReasonAliases: { legacy: "missing" } })).toThrow("Unknown skip reason alias target");
    expect(() => validateIndustryPack({ ...PET_WASTE_REMOVAL_PACK, noncompletionReasonAliases: { customer_skip: "other" } })).toThrow("Invalid skip reason alias");
    const badStyle = { ...HOUSE_CLEANING_PACK, locationFields: [{ ...HOUSE_CLEANING_PACK.locationFields[0], displayAs: "script" }] } as unknown as IndustryPack;
    expect(() => validateIndustryPack(badStyle)).toThrow("display style");
  });
});
