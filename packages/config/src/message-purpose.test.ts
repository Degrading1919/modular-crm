import { expect, it } from "vitest";
import { builtInMessagePurpose, messagePurpose, readServerConfig, SERVICE_MESSAGE_KEYS } from "./index.ts";
it("keeps operational messages separate from promotions and conservative unknowns", () => {
  for (const key of SERVICE_MESSAGE_KEYS) expect(builtInMessagePurpose(key)).toBe("service");
  for (const key of ["review-request", "promotion", "win-back", "quote-followup", undefined, "unknown"]) expect(builtInMessagePurpose(key)).toBe("marketing");
  expect(messagePurpose("service")).toBe("service"); expect(messagePurpose("account")).toBe("account");
  expect(builtInMessagePurpose("password-setup")).toBe("account");
  expect(messagePurpose("transactional")).toBe("service"); expect(messagePurpose(undefined)).toBe("marketing");
  expect(messagePurpose("automation")).toBe("marketing");
});
it("validates shared sender limits and the configurable platform name", () => {
  expect(readServerConfig({}).platformEmailLimits).toEqual({ hourly: 100, daily: 500, firstWeekHourly: 25, firstWeekDaily: 100 });
  expect(readServerConfig({ PLATFORM_NAME: "Service Desk", PLATFORM_EMAIL_HOURLY_LIMIT: "200" }).platformName).toBe("Service Desk");
  for (const value of ["0", "-1", "1.5", "NaN", "1000001"]) expect(() => readServerConfig({ PLATFORM_EMAIL_DAILY_LIMIT: value })).toThrow("PLATFORM_EMAIL_DAILY_LIMIT");
  expect(() => readServerConfig({ PLATFORM_EMAIL_FIRST_WEEK_DAILY_LIMIT: "501" })).toThrow("First-week");
  expect(() => readServerConfig({ PLATFORM_NAME: "CRM\r\nBcc: victim" })).toThrow("PLATFORM_NAME");
});
