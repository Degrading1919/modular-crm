import { expect, it } from "vitest";
import { moneyValue } from "../src/money.ts";
it("formats actual currency minor units without hard-coding cents", () => {
  expect(moneyValue(3000)).toBe("$30.00"); expect(moneyValue(3000, "JPY")).toBe("¥3,000"); expect(moneyValue(3000, "KWD")).toContain("3.000");
});
