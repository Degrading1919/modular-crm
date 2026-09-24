import type { NextConfig } from "next";

const config: NextConfig = {
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
