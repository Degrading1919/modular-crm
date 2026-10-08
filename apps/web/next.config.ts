import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  // A single isolated browser fixture may reach development assets. This does
  // not affect production routing or allow customer Hosts into private APIs.
  allowedDevOrigins: process.env.DOMAIN_VERIFICATION_MODE === "mock" ? ["signup-e2e.example.test"] : [],
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: [
    "@modular-crm/automations",
    "@modular-crm/config",
    "@modular-crm/connectors",
    "@modular-crm/db",
    "@modular-crm/domain",
    "@modular-crm/industry-packs",
    "@modular-crm/pricing",
    "@modular-crm/reporting"
  ]
};

export default config;
