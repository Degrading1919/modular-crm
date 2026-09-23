import { expect, it } from "vitest";
import { PET_WASTE_REMOVAL_PACK, getIndustryPack, materializeIndustryPack, validateIndustryPack } from "./index.ts";

it("ships a complete configuration-only reference pack", () => {
  validateIndustryPack(PET_WASTE_REMOVAL_PACK);
  expect(PET_WASTE_REMOVAL_PACK.services).toHaveLength(8);
  expect(PET_WASTE_REMOVAL_PACK.recurrencePresets.map((item) => item.key)).toContain("every-four-weeks");
  expect(PET_WASTE_REMOVAL_PACK.locationFields.find((field) => field.key === "gate_code")?.sensitive).toBe(true);
  expect(PET_WASTE_REMOVAL_PACK.pricingTemplates.every((template) => template.requiresTenantAmount)).toBe(true);
  expect(getIndustryPack("pet-waste-removal")).toBe(PET_WASTE_REMOVAL_PACK);
});

it("detaches installed defaults from package data", () => {
  const installed = materializeIndustryPack("pet-waste-removal");
  (installed as unknown as { services: { name: string }[] }).services[0]!.name = "My Service";
  expect(PET_WASTE_REMOVAL_PACK.services[0]!.name).toBe("Recurring Cleanup");
});
