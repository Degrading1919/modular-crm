import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

// Build placeholders exist only in this child, never Docker ENV/ARG or a file.
// No deployment credentials are accepted at build time or embedded in an image.
const env = { ...process.env, NODE_ENV: "production", LOCAL_SMOKE_TEST: "true",
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  WEBHOOK_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  DATABASE_URL: "postgresql://build@127.0.0.1:1/build",
  APP_BASE_URL: "http://localhost:3000", BETTER_AUTH_URL: "http://localhost:3000", PUBLIC_BASE_URL: "http://localhost:3000",
  SMTP_HOST: "smtp.invalid", SMTP_PORT: "587", SMTP_FROM: "build@example.invalid", MOCK_CONNECTORS: "false", DOMAIN_VERIFICATION_MODE: "dns",
};
await mkdir("apps/web/public", { recursive: true }); // This app may have no public assets yet.
const result = spawnSync("pnpm", ["--filter", "@modular-crm/web", "build"], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
