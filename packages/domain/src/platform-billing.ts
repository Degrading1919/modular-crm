export type SubscriptionStatus = "trialing" | "active" | "past_due" | "read_only" | "canceled";
export type BillingSnapshot = { customerId: string; subscriptionId: string; status: SubscriptionStatus; priceId?: string;
  planKey?: string; currency: string; interval: "month" | "year"; periodEnd?: string; trialEnd?: string };
export type BillingNotification = { id: string; created: number; type: string; customerId: string; subscriptionId: string; hostedSessionReference?: string; snapshot?: BillingSnapshot };
export function billingTransition(current: { status: string; graceEnd: Date | null; pastDueAt: Date | null }, next: SubscriptionStatus, at: Date, graceDays: number) {
  if (next === "past_due" || next === "read_only") {
    const pastDueAt = current.pastDueAt ?? at;
    const graceEnd = current.graceEnd ?? new Date(pastDueAt.getTime() + graceDays * 86400000);
    return { status: next === "read_only" || current.status === "read_only" || graceEnd <= at ? "read_only" : "past_due", graceEnd, pastDueAt };
  }
  return { status: next, graceEnd: null, pastDueAt: null };
}
export function billingReadOnly(status: string): boolean { return status === "read_only" || status === "canceled"; }
