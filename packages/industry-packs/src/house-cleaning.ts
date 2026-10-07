import type { IndustryPack } from "./index.ts";

export const HOUSE_CLEANING_PACK: IndustryPack = {
  key: "house-cleaning", version: "1.0.0", displayName: "House Cleaning", customerTypes: ["residential", "commercial"],
  terminology: { customer: "Customer", serviceLocation: "Home", customerAsset: "Room", workArea: "Property", job: "Cleaning visit", servicePlan: "Cleaning plan", fieldTechnician: "Cleaner" },
  assets: [{ key: "room", label: "Room", pluralLabel: "Rooms", fields: [
    { key: "name", label: "Name", type: "text", required: true, signupVisible: true, customerVisible: true, customerEditable: true },
    { key: "floor_surface", label: "Floor surface", type: "enum", options: ["wood", "tile", "carpet", "other"], defaultValue: "wood", signupVisible: true, customerVisible: true, customerEditable: true },
    { key: "care_notes", label: "Care notes", type: "text", signupVisible: true, customerVisible: true, customerEditable: true },
  ] }],
  locationFields: [
    { key: "room_count", label: "Rooms to clean", type: "number", required: true, defaultValue: 1, signupVisible: true, customerVisible: true },
    { key: "home_type", label: "Home type", type: "enum", options: ["house", "apartment", "other"], defaultValue: "house", signupVisible: true, customerVisible: true, customerEditable: true },
    { key: "supplies_provided", label: "I provide cleaning supplies", type: "boolean", defaultValue: false, signupVisible: true, customerVisible: true, customerEditable: true },
    { key: "first_visit", label: "Preferred first visit", type: "date", signupVisible: true, customerVisible: true },
    { key: "entry_instructions", label: "Entry instructions", type: "text", sensitive: true, signupVisible: true },
  ],
  services: [{ key: "recurring-cleaning", name: "Recurring Cleaning", kind: "recurring", defaultEnabled: true, estimatedMinutes: 90 }, { key: "deep-cleaning", name: "Deep Cleaning", kind: "one_time", defaultEnabled: true, estimatedMinutes: 150 }],
  recurrencePresets: [{ key: "weekly", label: "Weekly", rrule: "FREQ=WEEKLY" }, { key: "every-two-weeks", label: "Every two weeks", rrule: "FREQ=WEEKLY;INTERVAL=2" }, { key: "every-four-weeks", label: "Every four weeks", rrule: "FREQ=WEEKLY;INTERVAL=4" }],
  formSteps: [{ key: "address", label: "Where can we help?", fields: ["service_address"] }, { key: "contact", label: "How can we reach you?", fields: ["name", "email", "phone"] }, { key: "service", label: "Choose your service", fields: ["service", "frequency", "room"] }, { key: "property", label: "Tell us about your property", fields: ["room_count", "home_type", "supplies_provided", "first_visit", "entry_instructions"] }, { key: "finish", label: "Review your request", fields: ["price_result", "terms_accepted"] }],
  jobChecklist: [{ key: "propertyConfirmed", label: "Confirmed the correct property", required: true }, { key: "roomsCleaned", label: "Cleaned the agreed rooms", required: true }, { key: "propertySecured", label: "Left the property secure", required: true }],
  noncompletionReasons: [{ key: "no_access", label: "Unable to access the home", billableByDefault: false }, { key: "unsafe_conditions", label: "Unsafe conditions", billableByDefault: false }, { key: "customer_requested", label: "Customer requested skip", billableByDefault: false }, { key: "other", label: "Other", billableByDefault: false }],
  workflows: { cleaning: ["scheduled", "dispatched", "en_route", "in_progress", "completed"] }, defaultAutomations: [], reports: [],
  pricingTemplates: [{ key: "room-count", name: "Rooms to clean", stage: "quantity", inputFields: ["room_count"], effect: "per_quantity", requiresTenantAmount: true }],
  intake: { quantity: { locationField: "room_count" } },
  importAliases: { "asset.room.name": ["room name", "room"], "asset.room.floor_surface": ["floor surface", "floor"], "location.room_count": ["room count", "rooms to clean"], "location.entry_instructions": ["entry instructions", "access instructions"] },
  recommendationQuestions: [], productCapabilityRecommendations: ["service_scheduling", "recurring_service_management", "website_publishing", "customer_self_service"].map(featureKey => ({ featureKey, recommendation: "normally_recommended", rationale: "Manage customer requests and recurring cleaning visits in one place." })),
  recommendedConnectorCapabilities: ["payments", "email", "calendar", "storage"], inventoryDefaults: [],
  website: { template: "route-service", sections: ["hero", "services", "service_area", "signup", "contact"], signupSteps: ["address", "contact", "service", "property", "finish"], heroHeadline: "A clean home. More time for you.", heroDescription: "Arrange reliable cleaning for your home, with a clear price and helpful local team." },
};
