export async function register() {
  // Builds compile the application; deployments validate their own runtime environment.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { getServerConfig } = await import("./lib/server-config");
    try {
      const config = getServerConfig();
      const { createPlatformBillingProvider } = await import("@modular-crm/connectors");
      await createPlatformBillingProvider(config.platformBilling).validatePlans();
      const { initializePlatformTrials } = await import("@modular-crm/db");
      const { getDb } = await import("./lib/db");
      await initializePlatformTrials(getDb(), config.platformBilling);
    }
    catch (error) {
      // Next catches a rejected hook without terminating its HTTP listener.
      // Configuration rejection is fatal, not a recoverable request error.
      const { ServerConfigurationError } = await import("@modular-crm/config");
      const { logJson } = await import("@modular-crm/config/observability");
      logJson("error", "configuration.invalid", { status: 500, errorCode: "invalid_server_configuration", configurationKeys: error instanceof ServerConfigurationError ? error.configurationKeys : [] });
      process.exit(1);
    }
  }
}
