import { afterEach, expect, it, vi } from "vitest";
import type { Page, Request } from "@playwright/test";
import { expectBoundedIdleApiGets, trackApiGets } from "../tests/e2e/idle-api-guard";

function browser() {
  let listener: ((request: Request) => void) | undefined;
  const off = vi.fn(() => { listener = undefined; });
  const page = { on: (_event: string, handler: typeof listener) => { listener = handler; }, off } as unknown as Page;
  const send = (path: string, method = "GET") => listener?.({ url: () => `http://localhost${path}`, method: () => method } as Request);
  return { page, send, off };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("counts only browser API GETs and collapses query changes to the same path", () => {
  const view = browser();
  const tracker = trackApiGets(view.page);
  view.send("/api/v1/automations/runs?limit=20");
  view.send("/api/v1/automations/runs?limit=100");
  view.send("/api/v1/automations/runs", "POST");
  view.send("/app/automations");
  expect([...tracker.counts]).toEqual([["/api/v1/automations/runs", 2]]);
  tracker.stop();
  view.send("/api/v1/automations/runs");
  expect(tracker.counts.get("/api/v1/automations/runs")).toBe(2);
});

it("fails a runaway path rather than polling or retrying until it looks quiet", async () => {
  vi.useFakeTimers(); vi.spyOn(console, "info").mockImplementation(() => undefined);
  const view = browser();
  const sample = expectBoundedIdleApiGets(view.page);
  const rejection = expect(sample).rejects.toThrow("API GET paths must not refetch repeatedly");
  for (let i = 0; i < 4; i++) view.send(`/api/v1/automations/runs?limit=${i}`);
  await vi.advanceTimersByTimeAsync(3_000);
  await rejection;
  expect(view.off).toHaveBeenCalledOnce();
});

it("accepts bounded legitimate reads and always removes the observer", async () => {
  vi.useFakeTimers(); vi.spyOn(console, "info").mockImplementation(() => undefined);
  const view = browser();
  const sample = expectBoundedIdleApiGets(view.page);
  view.send("/api/v1/auth/me");
  view.send("/api/v1/field/today");
  await vi.advanceTimersByTimeAsync(3_000);
  expect([...(await sample)]).toEqual([["/api/v1/auth/me", 1], ["/api/v1/field/today", 1]]);
  expect(view.off).toHaveBeenCalledOnce();
});
