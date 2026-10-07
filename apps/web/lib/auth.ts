import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { schema } from "@modular-crm/db";
import { getDb } from "./db";
import { authSigningSecret } from "./runtime-secret";
import { toPasswordSetupUrl } from "./auth-links";
import { logJson } from "@modular-crm/config/observability";

export const auth = betterAuth({
  appName: "Modular CRM",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: authSigningSecret(),
  // Library diagnostics can carry arbitrary exception data; record metadata only.
  logger: { log: (level) => logJson(level === "error" ? "error" : level === "warn" ? "warn" : "info", "auth.library_event", { component: "auth" }) },
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      const { sendPlatformEmail, passwordSetupBusiness, accountEmailBusiness } = await import("./mail");
      const setupUrl = toPasswordSetupUrl(url, process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
      await sendPlatformEmail(user.email, "Set your Modular CRM password", `Open this link to set your password: ${setupUrl}`, await passwordSetupBusiness(getDb(), user.id, setupUrl) ?? await accountEmailBusiness(getDb(), user.id));
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { sendPlatformEmail, accountEmailBusiness } = await import("./mail");
      await sendPlatformEmail(user.email, "Verify your Modular CRM email", `Open this link to verify your email: ${url}`, await accountEmailBusiness(getDb(), user.id));
    },
  },
  // Shared, atomic PostgreSQL limits live in the HTTP adapter and V1 API wrapper.
  rateLimit: { enabled: false },
});
