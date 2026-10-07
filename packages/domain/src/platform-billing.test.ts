import { expect, it } from "vitest";
import { billingReadOnly, billingTransition } from "./platform-billing.ts";
it("keeps the original grace deadline across repeated failures and recovers explicitly", () => {
  const at = new Date("2026-10-07T00:00:00Z");
  const due = billingTransition({ status: "active", graceEnd: null, pastDueAt: null }, "past_due", at, 7);
  expect(due).toMatchObject({ status: "past_due", pastDueAt: at, graceEnd: new Date("2026-10-14T00:00:00Z") });
  expect(billingTransition(due, "past_due", new Date("2026-10-10"), 7)).toEqual(due);
  const expired = billingTransition(due, "past_due", new Date("2026-10-14"), 7);
  expect(expired.status).toBe("read_only");
  expect(billingTransition(expired, "past_due", new Date("2026-10-15"), 7).status).toBe("read_only");
  expect(billingTransition(expired, "active", new Date("2026-10-15"), 7)).toEqual({ status: "active", pastDueAt: null, graceEnd: null });
});
it.each(["read_only", "canceled"])("makes %s read-only without deleting the business", status => expect(billingReadOnly(status)).toBe(true));
it.each(["trialing", "active", "past_due"])("allows business writes during %s", status => expect(billingReadOnly(status)).toBe(false));
