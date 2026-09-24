import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { schema } from "@modular-crm/db";
import { getDb } from "./db";
import { authSigningSecret } from "./runtime-secret";
import { toPasswordSetupUrl } from "./auth-links";

export const auth = betterAuth({
  appName: "Modular CRM",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: authSigningSecret(),
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      const { sendDevelopmentEmail } = await import("./mail");
      const setupUrl = toPasswordSetupUrl(url, process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
      await sendDevelopmentEmail(user.email, "Set your Modular CRM password", `Open this link to set your password: ${setupUrl}`);
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { sendDevelopmentEmail } = await import("./mail");
      await sendDevelopmentEmail(user.email, "Verify your Modular CRM email", `Open this link to verify your email: ${url}`);
    },
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
});
