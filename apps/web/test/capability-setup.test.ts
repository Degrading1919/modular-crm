import { describe, expect, it } from "vitest";
import * as React from "react";

Object.assign(globalThis, { React });
const {
  featureIsUsable,
  featureIsVisible,
  initiallySelectedModuleKeys,
  isWebsitePublishingUsable,
} = await import("../components/CapabilitySetup");
import type { CapabilityModule } from "../components/CapabilitySetup";

describe("capability setup and navigation", () => {
  it("hides a hidden feature from navigation while keeping its usable route available", () => {
    const features = { route_planning: { visible: false, usable: true } };

    expect(featureIsVisible(features, ["route_planning"])).toBe(false);
    expect(featureIsUsable(features, ["route_planning"])).toBe(true);
  });

  it("blocks an unusable feature route and leaves unmapped core routes available", () => {
    const features = { website_publishing: { visible: false, usable: false } };

    expect(featureIsVisible(features, ["website_publishing"])).toBe(false);
    expect(featureIsUsable(features, ["website_publishing"])).toBe(false);
    expect(featureIsUsable(features, [])).toBe(true);
  });

  it("skips website publishing when the selected capabilities cannot publish a site", () => {
    expect(isWebsitePublishingUsable({ modules: [], features: { website_publishing: { usable: true } } })).toBe(true);
    expect(isWebsitePublishingUsable({ modules: [], features: { website_publishing: { usable: false } } })).toBe(false);
    expect(isWebsitePublishingUsable(null)).toBe(false);
  });

  it("starts setup from recommendations and management from the capabilities already in use", () => {
    const modules: CapabilityModule[] = [
      { key: "core", name: "Core", required: true },
      { key: "routes", name: "Routes", entitled: true, enabled: true },
      { key: "inventory", name: "Inventory", entitled: false, enabled: true },
      { key: "messages", name: "Messages", entitled: true, enabled: false },
    ];

    expect(initiallySelectedModuleKeys(modules, "setup", ["core", "inventory"])).toEqual(["core", "inventory"]);
    expect(initiallySelectedModuleKeys(modules, "manage")).toEqual(["core", "routes"]);
  });
});
