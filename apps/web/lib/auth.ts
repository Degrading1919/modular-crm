import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { schema } from "@modular-crm/db";
import { getDb } from "./db";

export const auth = betterAuth({
  appName: "Modular CRM",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-replace-before-deploying-0123456789",
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      const { sendDevelopmentEmail } = await import("./mail");
      await sendDevelopmentEmail(user.email, "Reset your Modular CRM password", `Open this link to reset your password: ${url}`);
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
