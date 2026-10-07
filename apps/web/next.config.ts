import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
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
