import { readServerConfig, type ServerConfig } from "@modular-crm/config";

const globalForConfig = globalThis as typeof globalThis & { modularServerConfig?: ServerConfig };
/** Called by instrumentation before serving requests; reused by server-only consumers. */
export function getServerConfig(): ServerConfig {
  return globalForConfig.modularServerConfig ??= readServerConfig(process.env);
}
