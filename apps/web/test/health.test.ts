import { afterEach, expect, it, vi } from "vitest";

const { checkReady } = vi.hoisted(() => ({ checkReady: vi.fn() }));
vi.mock("@modular-crm/db", () => ({ checkDatabaseReady: checkReady }));
import { GET as live } from "../app/api/health/live/route.ts";
import { GET as ready } from "../app/api/health/ready/route.ts";

afterEach(() => { vi.unstubAllEnvs(); checkReady.mockReset(); });

it("liveness needs neither database nor auth and exposes only a generic status", async () => {
  vi.stubEnv("DATABASE_URL", undefined);
  const response = live();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(checkReady).not.toHaveBeenCalled();
});
it.each([true, false])("readiness maps the bounded database/migration probe (%s) to 200/503", async (available) => {
  vi.stubEnv("DATABASE_URL", "postgresql://private-host/crm");
  checkReady.mockResolvedValue(available);
  const response = await ready();
  expect(checkReady).toHaveBeenCalledWith("postgresql://private-host/crm");
  expect(response.status).toBe(available ? 200 : 503);
  expect(await response.json()).toEqual({ status: available ? "ok" : "unavailable" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
