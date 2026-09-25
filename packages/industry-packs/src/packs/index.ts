import { BUILDING_SYSTEMS_PACKS } from "./building-systems.ts";
import { CLEANING_SERVICES_PACKS } from "./cleaning-services.ts";
import { CONSTRUCTION_TRADES_A_PACKS } from "./construction-trades-a.ts";
import { CONSTRUCTION_TRADES_B_PACKS } from "./construction-trades-b.ts";
import { CUSTOM_INSTALLATION_PACKS } from "./custom-installations.ts";
import { EVENTS_RENTALS_PACKS } from "./events-rentals.ts";
import { PROPERTY_SERVICES_PACKS } from "./property-services.ts";
import { PERSONAL_PET_PACKS } from "./personal-pet.ts";
import { PROFESSIONAL_SERVICES_PACKS } from "./professional-services.ts";
import { RESTORATION_LOGISTICS_PACKS } from "./restoration-logistics.ts";
import { SPECIALTY_INSTALLATION_PACKS } from "./specialty-installations.ts";
import { VEHICLE_MARINE_PACKS } from "./vehicle-marine.ts";
import type { IndustryPack } from "../index.ts";

/** Static, portable registry additions. Add a cohort here when its packs pass the registry contract. */
export const ADDITIONAL_INDUSTRY_PACKS: readonly IndustryPack[] = [
  ...BUILDING_SYSTEMS_PACKS,
  ...CLEANING_SERVICES_PACKS,
  ...CONSTRUCTION_TRADES_A_PACKS,
  ...CONSTRUCTION_TRADES_B_PACKS,
  ...CUSTOM_INSTALLATION_PACKS,
  ...EVENTS_RENTALS_PACKS,
  ...PROPERTY_SERVICES_PACKS,
  ...PERSONAL_PET_PACKS,
  ...PROFESSIONAL_SERVICES_PACKS,
  ...RESTORATION_LOGISTICS_PACKS,
  ...SPECIALTY_INSTALLATION_PACKS,
  ...VEHICLE_MARINE_PACKS,
];
