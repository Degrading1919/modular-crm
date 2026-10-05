import { expect, it } from "vitest";
import { refundReviewConfirmation } from "../lib/refund-review-copy";
it("requires explicit excess and duplicate-record warning before recording an above-payment refund", () => {
  const copy = refundReviewConfirmation("refunded", 800, 400, 1000, "USD");
  expect(copy).toContain("exceed this payment by $2.00"); expect(copy).toContain("balance may exceed its original total"); expect(copy).toContain("not a duplicate record");
  expect(refundReviewConfirmation("refunded", 600, 400, 1000, "USD")).not.toContain("Warning:");
  expect(refundReviewConfirmation("refunded", 800, 800, 1000, "USD", 800)).not.toContain("Warning:");
  expect(refundReviewConfirmation("refunded", 800, 1200, 1000, "USD", 800)).toContain("exceed this payment by $2.00");
  expect(refundReviewConfirmation("not_refunded", 800, 400, 1000, "USD")).toContain("no refund happened");
});
