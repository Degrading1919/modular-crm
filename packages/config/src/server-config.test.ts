import { describe, expect, it, vi } from "vitest";
import { DEVELOPMENT_AUTH_SECRET, readServerConfig } from "./index.ts";

const healthy = {
  PLATFORM_STRIPE_SECRET_KEY: "sk_test_platformfixture", PLATFORM_STRIPE_WEBHOOK_SECRET: "whsec_platformfixture", PLATFORM_STRIPE_MODE: "test",
  PLATFORM_BILLING_PLANS_JSON: JSON.stringify([{ key: "standard", name: "Standard", seats: 10, capabilities: ["*"], prices: { USD: { monthly: 4900, monthlyPriceId: "price_standard" } } }]),
  NODE_ENV: "production", DATABASE_URL: "postgresql://db.example/crm",
  BETTER_AUTH_SECRET: "a-private-signing-secret-of-more-than-32-characters",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
  CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
  BETTER_AUTH_URL: "https://crm.example", APP_BASE_URL: "https://crm.example", PUBLIC_BASE_URL: "https://sites.example",
  SMTP_HOST: "smtp.example", SMTP_PORT: "587", SMTP_FROM: "Service team <team@example.test>",
};

describe("production startup configuration", () => {
  it("accepts task-role storage without static keys and rejects partial static configuration at startup", () => {
    const storage = { OBJECT_STORAGE_ENDPOINT: "https://s3.example.test", OBJECT_STORAGE_BUCKET: "crm-files", OBJECT_STORAGE_CREDENTIAL_MODE: "task-role" };
    expect(readServerConfig({ ...healthy, ...storage }).environment).toBe("production");
    expect(() => readServerConfig({ ...healthy, ...storage, OBJECT_STORAGE_CREDENTIAL_MODE: "static" })).toThrow("incomplete");
  });
  it("defaults to one production proxy and none locally, and validates the fixed hop count", () => {
    expect(readServerConfig(healthy).trustedProxyHops).toBe(1);
    expect(readServerConfig({ NODE_ENV: "test" }).trustedProxyHops).toBe(0);
    expect(readServerConfig({ ...healthy, TRUSTED_PROXY_HOPS: "2" }).trustedProxyHops).toBe(2);
    for (const TRUSTED_PROXY_HOPS of ["0", "17", "-1", "1.5", "NaN", "", "1e1"]) expect(() => readServerConfig({ ...healthy, TRUSTED_PROXY_HOPS })).toThrow("TRUSTED_PROXY_HOPS");
  });
  it("warns without failing when no reporter is configured and rejects unsafe collector URLs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(readServerConfig(healthy).environment).toBe("production");
      expect(warn.mock.calls).toHaveLength(1);
      expect(JSON.parse(warn.mock.calls[0]![0] as string)).toMatchObject({ level: "warn", event: "error.reporter_not_configured", route: "startup" });
      warn.mockClear();
      expect(readServerConfig({ ...healthy, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://collector.example/v1/logs" }).environment).toBe("production");
      expect(warn).not.toHaveBeenCalled();
      for (const endpoint of ["http://collector.example/v1/logs", "https://user:password@collector.example/v1/logs", "file:///private"]) {
        expect(() => readServerConfig({ ...healthy, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: endpoint })).toThrow("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT");
      }
    } finally { warn.mockRestore(); }
  });
  it("hides unconfigured payments and validates complete matching Stripe mode without leaking secrets", () => {
    expect(readServerConfig(healthy).stripePayments).toBeUndefined();
    const configured = { ...healthy, PAYMENTS_STRIPE_SECRET_KEY: "sk_test_fixture", PAYMENTS_STRIPE_WEBHOOK_SECRET: "whsec_fixture", PAYMENTS_STRIPE_MODE: "test" };
    expect(readServerConfig(configured).stripePayments?.mode).toBe("test");
    for (const changed of [{ PAYMENTS_STRIPE_WEBHOOK_SECRET: undefined }, { PAYMENTS_STRIPE_MODE: "live" }, { PAYMENTS_STRIPE_SECRET_KEY: "sk_live_private" }]) {
      expect(() => readServerConfig({ ...configured, ...changed })).toThrow(/PAYMENTS_STRIPE/);
    }
    expect(() => readServerConfig({ ...configured, NODE_ENV: "test", PAYMENTS_STRIPE_SECRET_KEY: "sk_live_private", PAYMENTS_STRIPE_MODE: "live" })).toThrow(/Live payment/);
  });
  it("accepts explicit production settings and freezes the server-only result", () => {
    const config = readServerConfig(healthy);
    expect(config).toMatchObject({ environment: "production", mockConnectors: false, publicBaseUrl: healthy.PUBLIC_BASE_URL, workerHealthPort: 3001 });
    expect(config.smtp).toMatchObject({ host: "smtp.example", port: 587, secure: false });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.smtp)).toBe(true);
  });
  it.each([
    ["DATABASE_URL", undefined], ["BETTER_AUTH_SECRET", undefined], ["BETTER_AUTH_SECRET", "short"],
    ["BETTER_AUTH_SECRET", DEVELOPMENT_AUTH_SECRET], ["BETTER_AUTH_SECRET", " ".repeat(40)],
    ["BETTER_AUTH_SECRET", ` ${DEVELOPMENT_AUTH_SECRET} `],
    ["WEBHOOK_SECRET_ENCRYPTION_KEY", undefined], ["WEBHOOK_SECRET_ENCRYPTION_KEY", "short"],
    ["WEBHOOK_SECRET_ENCRYPTION_KEY", `${healthy.WEBHOOK_SECRET_ENCRYPTION_KEY}=`],
    ["CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", undefined], ["CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", "not-base64url"],
    ["MOCK_CONNECTORS", "true"], ["DOMAIN_VERIFICATION_MODE", "mock"],
    ["BETTER_AUTH_URL", undefined], ["APP_BASE_URL", undefined], ["PUBLIC_BASE_URL", undefined],
    ["BETTER_AUTH_URL", "http://crm.example"], ["APP_BASE_URL", "http://crm.example"], ["PUBLIC_BASE_URL", "http://crm.example"],
    ["PUBLIC_BASE_URL", "https://"], ["APP_BASE_URL", "https://user:private@crm.example"],
    ["SMTP_HOST", undefined], ["SMTP_HOST", "mailpit"], ["SMTP_HOST", "127.0.0.1"], ["SMTP_HOST", "localhost"],
    ["SMTP_PORT", "1025"], ["SMTP_FROM", undefined], ["SMTP_FROM", "no-reply@localhost"],
  ])("refuses %s=%s without disclosing values", (key, value) => {
    expect(() => readServerConfig({ ...healthy, [key]: value })).toThrow(key.split("_")[0]);
  });
  it("reports every problem together and does not include secrets, URLs or passwords", () => {
    let message = "";
    try { readServerConfig({ NODE_ENV: "production", BETTER_AUTH_SECRET: "sensitive-short", CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "private-key", SMTP_PASSWORD: "private-password", PUBLIC_BASE_URL: "https://user:private-url@crm.example", MOCK_CONNECTORS: "true", DOMAIN_VERIFICATION_MODE: "mock" }); }
    catch (error) { message = (error as Error).message; }
    for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "WEBHOOK_SECRET_ENCRYPTION_KEY", "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", "BETTER_AUTH_URL", "APP_BASE_URL", "PUBLIC_BASE_URL", "SMTP_HOST", "SMTP_FROM", "MOCK_CONNECTORS", "DOMAIN_VERIFICATION_MODE"]) expect(message).toContain(key);
    for (const value of ["sensitive-short", "private-key", "private-password", "private-url", "crm.example"]) expect(message).not.toContain(value);
  });
  it("local smoke mode permits only loopback HTTP and bypasses no other production rule", () => {
    const local = { ...healthy, LOCAL_SMOKE_TEST: "true", BETTER_AUTH_URL: "http://localhost:3000", APP_BASE_URL: "http://127.0.0.1:3000", PUBLIC_BASE_URL: "http://[::1]:3000" };
    expect(readServerConfig(local).localSmokeTest).toBe(true);
    expect(() => readServerConfig({ ...local, APP_BASE_URL: "http://crm.example" })).toThrow("APP_BASE_URL");
    expect(() => readServerConfig({ ...local, APP_BASE_URL: "http://127.external.example" })).toThrow("APP_BASE_URL");
    expect(() => readServerConfig({ ...local, MOCK_CONNECTORS: "true" })).toThrow("MOCK_CONNECTORS");
    expect(() => readServerConfig({ ...local, SMTP_HOST: "mailpit" })).toThrow("SMTP_HOST");
    expect(() => readServerConfig({ ...local, BETTER_AUTH_SECRET: undefined })).toThrow("BETTER_AUTH_SECRET");
  });
  it("does not require production variables for development or tests", () => {
    expect(readServerConfig({}).smtp).toMatchObject({ host: "localhost", port: 1025 });
    expect(readServerConfig({ NODE_ENV: "test" }).mockConnectors).toBe(true);
  });
  it("uses bounded worker readiness defaults and configurable limits", () => {
    expect(readServerConfig({})).toMatchObject({ workerPollStaleMs: 60_000, workerJobMaxMs: 300_000 });
    expect(readServerConfig({ WORKER_POLL_STALE_MS: "10000", WORKER_JOB_MAX_MS: "60000" })).toMatchObject({ workerPollStaleMs: 10_000, workerJobMaxMs: 60_000 });
  });
  it.each(["0", "NaN", "1000.5", "86400001", "Infinity"])("rejects unbounded readiness limit %s", (value) => {
    for (const key of ["WORKER_POLL_STALE_MS", "WORKER_JOB_MAX_MS"]) expect(() => readServerConfig({ [key]: value })).toThrow(key);
  });
  it.each([["MOCK_CONNECTORS", "yes"], ["LOCAL_SMOKE_TEST", "yes"], ["SMTP_PORT", "bad"], ["SMTP_SECURE", "yes"], ["WORKER_HEALTH_PORT", "0"], ["SMTP_USER", "user"]])("rejects malformed %s", (key, value) => {
    expect(() => readServerConfig({ ...healthy, [key]: value })).toThrow(key);
  });
});
