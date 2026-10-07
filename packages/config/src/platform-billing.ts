export type BillingPlan = Readonly<{ key: string; name: string; seats: number; capabilities: readonly string[];
  prices: Readonly<Record<string, { monthly: number; yearly?: number; monthlyPriceId?: string; yearlyPriceId?: string }>>; placeholder?: boolean }>;
export type PlatformBillingConfig = Readonly<{ provider: "mock" | "stripe"; plans: readonly BillingPlan[]; trialDays: number; graceDays: number;
  stripe?: { secretKey: string; webhookSecret: string; mode: "test" | "live" }; operatorUserIds: readonly string[] }>;
export const LOCAL_BILLING_PLANS: readonly BillingPlan[] = [
  { key: "local-standard", name: "Standard (local example)", seats: 10, capabilities: ["*"], prices: { USD: { monthly: 4900, yearly: 49000 } }, placeholder: true },
  { key: "local-small", name: "Small team (local example)", seats: 2, capabilities: ["customer_records", "invoicing", "payment_collection"], prices: { USD: { monthly: 1900 } }, placeholder: true },
];
/** Server-owned prices; neither tenant JSON nor browser redirects can configure entitlements. */
export function readPlatformBillingConfig(env: Record<string, string | undefined>): PlatformBillingConfig {
  const production = env.NODE_ENV === "production";
  const provider = env.PLATFORM_BILLING_PROVIDER ?? (production ? "stripe" : "mock");
  const fail = (key: string): never => { throw new Error(`Invalid ${key} configuration`); };
  const isolatedSmoke = env.LOCAL_SMOKE_TEST === "true" && ["APP_BASE_URL", "PUBLIC_BASE_URL", "BETTER_AUTH_URL"].every(key => {
    try { const url = new URL(env[key] ?? ""); return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password; } catch { return false; }
  });
  if (!["mock", "stripe"].includes(provider) || (production && provider === "mock" && !isolatedSmoke)) fail("PLATFORM_BILLING_PROVIDER");
  let input: unknown;
  try { input = env.PLATFORM_BILLING_PLANS_JSON ? JSON.parse(env.PLATFORM_BILLING_PLANS_JSON) : production ? [] : LOCAL_BILLING_PLANS; }
  catch { fail("PLATFORM_BILLING_PLANS_JSON"); }
  if (!Array.isArray(input) || !input.length || input.length > 30) fail("PLATFORM_BILLING_PLANS_JSON");
  const plans = input as BillingPlan[];
  const keys = new Set<string>();
  const priceIds = new Set<string>();
  for (const plan of plans) {
    if (!plan || !/^[a-z][a-z0-9-]{0,63}$/.test(plan.key) || keys.has(plan.key) || typeof plan.name !== "string" || !plan.name.trim() || plan.name.length > 100
      || !Number.isSafeInteger(plan.seats) || plan.seats < 1 || plan.seats > 100000 || !Array.isArray(plan.capabilities)
      || !plan.capabilities.length || plan.capabilities.some(key => typeof key !== "string" || !/^(\*|[a-z][a-z0-9_]{0,99})$/.test(key))
      || (production && plan.placeholder) || !plan.prices || typeof plan.prices !== "object" || !Object.keys(plan.prices).length) fail("PLATFORM_BILLING_PLANS_JSON");
    keys.add(plan.key);
    for (const [currency, price] of Object.entries(plan.prices)) {
      if (!/^[A-Z]{3}$/.test(currency) || !price || !Number.isSafeInteger(price.monthly) || price.monthly < 1
        || (price.yearly !== undefined && (!Number.isSafeInteger(price.yearly) || price.yearly < 1))
        || (provider === "stripe" && (!/^price_[a-zA-Z0-9]+$/.test(price.monthlyPriceId ?? "") || (price.yearly !== undefined && !/^price_[a-zA-Z0-9]+$/.test(price.yearlyPriceId ?? ""))))) fail("PLATFORM_BILLING_PLANS_JSON provider prices");
      for (const id of [price.monthlyPriceId, price.yearlyPriceId].filter(Boolean) as string[]) {
        if (priceIds.has(id)) fail("PLATFORM_BILLING_PLANS_JSON duplicate provider price"); priceIds.add(id);
      }
    }
  }
  const days = (key: string, fallback: number) => { const value = Number(env[key] ?? fallback); if (!Number.isInteger(value) || value < 1 || value > 365) fail(key); return value; };
  const stripeConfigured = [env.PLATFORM_STRIPE_SECRET_KEY, env.PLATFORM_STRIPE_WEBHOOK_SECRET, env.PLATFORM_STRIPE_MODE].some(Boolean);
  let stripe: PlatformBillingConfig["stripe"];
  if (provider === "stripe" || stripeConfigured) {
    const secretKey = env.PLATFORM_STRIPE_SECRET_KEY ?? "", webhookSecret = env.PLATFORM_STRIPE_WEBHOOK_SECRET ?? "", mode = env.PLATFORM_STRIPE_MODE;
    if (!/^sk_(test|live)_[a-zA-Z0-9]+$/.test(secretKey) || !/^whsec_[a-zA-Z0-9]+$/.test(webhookSecret) || !["test", "live"].includes(mode ?? "") || !secretKey.startsWith(`sk_${mode}_`)
      || (!production && mode === "live") || secretKey === env.PAYMENTS_STRIPE_SECRET_KEY || webhookSecret === env.PAYMENTS_STRIPE_WEBHOOK_SECRET) fail("PLATFORM_STRIPE_SECRET_KEY/PLATFORM_STRIPE_WEBHOOK_SECRET/PLATFORM_STRIPE_MODE (separate matching credentials required)");
    stripe = { secretKey, webhookSecret, mode: mode as "test" | "live" };
  }
  return { provider: provider as "mock" | "stripe", plans, trialDays: days("PLATFORM_BILLING_TRIAL_DAYS", 14), graceDays: days("PLATFORM_BILLING_GRACE_DAYS", 7), stripe,
    operatorUserIds: (env.PLATFORM_OPERATOR_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean) };
}
