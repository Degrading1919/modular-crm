import { describe, expect, it } from "vitest";
import { paymentReceiptDestination, recordDestination } from "../lib/resource-navigation";

describe("resource row destinations", () => {
  it("preserves ordinary generic record navigation", () => {
    expect(recordDestination("customers", { id: "customer-id" })).toEqual({ href: "/app/customers/customer-id", label: "View" });
  });
  it("can explicitly disable generic record navigation", () => {
    expect(recordDestination("read-only", { id: "record-id" }, false)).toBeNull();
  });
  it.each(["succeeded", "refunded", "partially_refunded"])("uses the receipt surface for a %s payment", (status) => {
    expect(recordDestination("payments", { id: "payment-id", status }, paymentReceiptDestination)).toEqual({ href: "/app/documents/receipt/payment-id", label: "View receipt" });
  });
  it.each(["failed", "pending", "processing", "canceled", "unknown", undefined])("renders a %s payment without a detail fallback", (status) => {
    expect(recordDestination("payments", { id: "payment-id", status }, paymentReceiptDestination)).toBeNull();
  });
});
