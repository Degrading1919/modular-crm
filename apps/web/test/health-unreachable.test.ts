import { afterEach, expect, it, vi } from "vitest";
import { GET as ready } from "../app/api/health/ready/route.ts";
import { GET as live } from "../app/api/health/live/route.ts";

afterEach(() => vi.unstubAllEnvs());
it("returns 503 through the real web readiness handler when PostgreSQL cannot be reached", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://health@127.0.0.1:1/unreachable");
  const response = await ready();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: "unavailable" });
  expect(live().status).toBe(200);
});
