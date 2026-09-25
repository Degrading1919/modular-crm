import { expect, it } from "vitest";
import {
  PET_WASTE_REMOVAL_PACK,
  evaluateProductCapabilityRecommendations,
  getIndustryPack,
  listIndustryPacks,
  materializeIndustryPack,
  validateIndustryPack,
  type IndustryPack,
  type ProductCapabilityRecommendation,
} from "./index.ts";

it("ships a complete configuration-only reference pack", () => {
  validateIndustryPack(PET_WASTE_REMOVAL_PACK);
  expect(PET_WASTE_REMOVAL_PACK.services).toHaveLength(8);
  expect(PET_WASTE_REMOVAL_PACK.recurrencePresets.map((item) => item.key)).toContain("every-four-weeks");
  expect(PET_WASTE_REMOVAL_PACK.locationFields.find((field) => field.key === "gate_code")?.sensitive).toBe(true);
  expect(PET_WASTE_REMOVAL_PACK.pricingTemplates.every((template) => template.requiresTenantAmount)).toBe(true);
  expect(getIndustryPack("pet-waste-removal")).toBe(PET_WASTE_REMOVAL_PACK);
});

it("registers each stable industry key once and validates the complete registry", () => {
  const packs = listIndustryPacks();
  const keys = packs.map((pack) => pack.key);
  expect(packs).toHaveLength(152);
  expect(new Set(keys).size).toBe(keys.length);
  for (const pack of packs) {
    validateIndustryPack(pack);
    expect(pack.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(getIndustryPack(pack.key)).toBe(pack);
  }
});

it("detaches installed defaults from package data", () => {
  const installed = materializeIndustryPack("pet-waste-removal");
  (installed as unknown as { services: { name: string }[] }).services[0]!.name = "My Service";
  expect(PET_WASTE_REMOVAL_PACK.services[0]!.name).toBe("Recurring Cleanup");
});

it("keeps product recommendations distinct from connector suggestions", () => {
  validateIndustryPack(PET_WASTE_REMOVAL_PACK);
  expect(PET_WASTE_REMOVAL_PACK.recommendedConnectorCapabilities).toEqual([
    "payments", "sms", "email", "routing", "geocoding", "accounting", "calendar", "storage",
  ]);
  expect(PET_WASTE_REMOVAL_PACK.productCapabilityRecommendations.map((item) => item.featureKey)).toContain("route_planning");
  expect(PET_WASTE_REMOVAL_PACK.productCapabilityRecommendations.every((item) => !("entitlement" in item))).toBe(true);
});

it("leaves unresolved recommendations conditional and reports the missing business answers", () => {
  const result = evaluateProductCapabilityRecommendations(PET_WASTE_REMOVAL_PACK);
  const byKey = new Map(result.map((item) => [item.featureKey, item]));

  expect(byKey.get("recurring_service_management")?.recommendation).toBe("normally_recommended");
  expect(byKey.get("route_planning")).toMatchObject({
    recommendation: "conditional",
    pendingAnswers: ["multiple_crews", "many_daily_stops"],
  });
  expect(byKey.get("multi_location_management")).toMatchObject({
    recommendation: "conditional",
    pendingAnswers: ["operates_multiple_locations"],
  });
});

it("recommends a focused owner-operated setup and resolves growth needs from answers", () => {
  const soloAnswers = {
    uses_field_technicians: false,
    accepts_online_bookings: false,
    prepares_estimates: false,
    multiple_crews: false,
    many_daily_stops: false,
    has_paid_staff: false,
    tracks_employee_hours: false,
    tracks_service_supplies: false,
    operates_multiple_locations: false,
  };
  const solo = new Map(evaluateProductCapabilityRecommendations(PET_WASTE_REMOVAL_PACK, soloAnswers).map((item) => [item.featureKey, item]));
  expect(solo.get("field_job_tracking")?.recommendation).toBe("optional");
  expect(solo.get("route_planning")?.recommendation).toBe("usually_unnecessary");
  expect(solo.get("time_tracking")?.recommendation).toBe("optional");
  expect(solo.get("payroll_inputs")?.recommendation).toBe("usually_unnecessary");
  expect(solo.get("inventory_tracking")?.recommendation).toBe("usually_unnecessary");
  expect(solo.get("multi_location_management")?.recommendation).toBe("usually_unnecessary");
  expect(solo.get("advanced_reporting")?.recommendation).toBe("usually_unnecessary");

  const growingAnswers = {
    uses_field_technicians: true,
    accepts_online_bookings: true,
    prepares_estimates: true,
    multiple_crews: true,
    has_paid_staff: true,
    tracks_employee_hours: true,
    tracks_service_supplies: true,
    operates_multiple_locations: true,
  };
  const growing = new Map(evaluateProductCapabilityRecommendations(PET_WASTE_REMOVAL_PACK, growingAnswers).map((item) => [item.featureKey, item]));
  for (const key of ["online_booking", "website_publishing", "estimate_management", "field_job_tracking", "route_planning", "time_tracking", "payroll_inputs", "inventory_tracking", "multi_location_management", "advanced_reporting"]) {
    expect(growing.get(key)?.recommendation, key).toBe("normally_recommended");
  }
  expect(growing.get("route_planning")?.pendingAnswers).toEqual([]);
});

it("rejects unknown answer references, duplicate feature recommendations, and unsafe product fields", () => {
  const withUnknownReference = JSON.parse(JSON.stringify(PET_WASTE_REMOVAL_PACK)) as IndustryPack;
  const unknownRefItems = withUnknownReference.productCapabilityRecommendations as ProductCapabilityRecommendation[];
  unknownRefItems[0] = {
    ...unknownRefItems[0]!,
    rules: [{ when: { op: "equals", answerKey: "unknown_answer", value: true }, recommendation: "optional" }],
  };
  expect(() => validateIndustryPack(withUnknownReference)).toThrow(/Unknown .* answer reference/);

  const withDuplicateFeature = JSON.parse(JSON.stringify(PET_WASTE_REMOVAL_PACK)) as IndustryPack;
  const duplicateItems = withDuplicateFeature.productCapabilityRecommendations as ProductCapabilityRecommendation[];
  duplicateItems.push({ ...duplicateItems[0]! });
  expect(() => validateIndustryPack(withDuplicateFeature)).toThrow(/Duplicate product feature recommendation/);

  const withUnsafeCommercialField = JSON.parse(JSON.stringify(PET_WASTE_REMOVAL_PACK)) as unknown as {
    productCapabilityRecommendations: (ProductCapabilityRecommendation & { price?: number })[];
  };
  withUnsafeCommercialField.productCapabilityRecommendations[0]!.price = 10;
  expect(() => validateIndustryPack(withUnsafeCommercialField as unknown as IndustryPack)).toThrow(/Unsupported Product recommendation .* field: price/);

  const withEntitlementField = JSON.parse(JSON.stringify(PET_WASTE_REMOVAL_PACK)) as unknown as IndustryPack & { grantsEntitlement?: boolean };
  withEntitlementField.grantsEntitlement = true;
  expect(() => validateIndustryPack(withEntitlementField)).toThrow(/Unsupported pack field: grantsEntitlement/);
});

it("rejects misspelled and type-invalid onboarding answers", () => {
  expect(() => evaluateProductCapabilityRecommendations(PET_WASTE_REMOVAL_PACK, { multi_crew: true })).toThrow(/Unknown onboarding answer/);
  expect(() => evaluateProductCapabilityRecommendations(PET_WASTE_REMOVAL_PACK, { multiple_crews: "yes" })).toThrow(/must be true or false/);
});
