import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "./client.ts";
import { accountEmailUsage, platformEmailPolicies, platformEmailUsage, tenants } from "./schema/index.ts";

export type PlatformEmailLimits = Readonly<{ hourly: number; daily: number; firstWeekHourly: number; firstWeekDaily: number }>;
export type EmailReservation = { allowed: true } | { allowed: false; nextSendAt: Date; note: string; code: "email_hourly_limit" | "email_daily_limit" };

/** UTC calendar windows. Count attempts conservatively, including transport failures/crash recovery. */
export async function reservePlatformEmail(db: Database, tenantId: string, limits: PlatformEmailLimits, now = new Date(), purpose: "service" | "marketing" = "service"): Promise<EmailReservation> {
  return db.transaction(async (tx) => {
    // A tenant lock serializes reservations across processes even before its first counter exists.
    const [tenant] = await tx.select({ createdAt: tenants.createdAt }).from(tenants).where(eq(tenants.id, tenantId)).for("update").limit(1);
    if (!tenant) throw new Error("Email business not found");
    const [override] = await tx.select().from(platformEmailPolicies).where(eq(platformEmailPolicies.tenantId, tenantId)).limit(1);
    if (override) {
      const values = [override.hourly, override.daily, override.firstWeekHourly, override.firstWeekDaily];
      if (values.some((value) => !Number.isSafeInteger(value) || value <= 0) || override.firstWeekHourly > override.hourly || override.firstWeekDaily > override.daily) throw new Error("Invalid email business limits");
      limits = override;
    }
    const firstWeek = now.getTime() < tenant.createdAt.getTime() + 7 * 86_400_000;
    // Promotions may consume only 80% of each total cap. Reserve at least one attempt
    // even for a tiny policy; service mail still observes the full absolute bounds.
    const headroom = (limit: number) => purpose === "marketing" ? Math.max(0, limit - Math.max(1, Math.ceil(limit * .2))) : limit;
    const hourlyLimit = headroom(firstWeek ? limits.firstWeekHourly : limits.hourly);
    const dailyLimit = headroom(firstWeek ? limits.firstWeekDaily : limits.daily);
    const hourStart = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const dayStart = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000);
    const [prior] = await tx.select().from(platformEmailUsage).where(eq(platformEmailUsage.tenantId, tenantId)).limit(1);
    const hourlyCount = prior?.hourStart.getTime() === hourStart.getTime() ? prior.hourlyCount : 0;
    const dailyCount = prior?.dayStart.getTime() === dayStart.getTime() ? prior.dailyCount : 0;
    if (dailyCount >= dailyLimit) return { allowed: false, nextSendAt: new Date(dayStart.getTime() + 86_400_000), code: "email_daily_limit", note: "Daily email limit reached; this will send tomorrow." };
    if (hourlyCount >= hourlyLimit) return { allowed: false, nextSendAt: new Date(hourStart.getTime() + 3_600_000), code: "email_hourly_limit", note: "Hourly email limit reached; this will send next hour." };
    const values = { tenantId, hourStart, dayStart, hourlyCount: hourlyCount + 1, dailyCount: dailyCount + 1 };
    await tx.insert(platformEmailUsage).values(values).onConflictDoUpdate({ target: platformEmailUsage.tenantId, set: values });
    return { allowed: true };
  });
}

export async function reserveAccountEmail(db: Database, recipient: string, now = new Date()): Promise<EmailReservation> {
  const recipientHash = createHash("sha256").update(recipient.trim().toLowerCase()).digest("hex");
  const hourStart = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  return db.transaction(async (tx) => {
    await tx.insert(accountEmailUsage).values({ recipientHash, hourStart, hourlyCount: 0 }).onConflictDoNothing();
    const [row] = await tx.select().from(accountEmailUsage).where(eq(accountEmailUsage.recipientHash, recipientHash)).for("update").limit(1);
    const count = row!.hourStart.getTime() === hourStart.getTime() ? row!.hourlyCount : 0;
    if (count >= 5) return { allowed: false, nextSendAt: new Date(hourStart.getTime() + 3_600_000), code: "email_hourly_limit", note: "Account emails to this address are limited; this will send next hour." };
    await tx.update(accountEmailUsage).set({ hourStart, hourlyCount: count + 1 }).where(eq(accountEmailUsage.recipientHash, recipientHash));
    return { allowed: true };
  });
}
