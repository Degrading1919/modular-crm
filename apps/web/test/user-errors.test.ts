import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../components/api";
import { balanceTotals, reportColumns, reportValue } from "../lib/presentation";
import { apiError } from "../lib/api/http";
import { z } from "zod";
import { drainQueue, type OfflineOperation } from "../components/field-queue";

afterEach(() => vi.unstubAllGlobals());

describe("truthful shared presentation", () => {
  it("uses plain report columns, hides implementation IDs and shares monetary formatting", () => {
    expect(reportColumns({ locationId: "internal", locationName: "Augusta", currency: "USD", invoicedCents: 3000, collectedCents: 1500, outstandingCents: 1500 }))
      .toEqual([{ key: "locationName", label: "Location" }, { key: "currency", label: "Currency" },
        { key: "invoicedCents", label: "Invoiced" }, { key: "collectedCents", label: "Collected" }, { key: "outstandingCents", label: "Open balance" }]);
    expect(reportValue("invoicedCents", 3000)).toBe("$30.00");
  });
  it("formats cents consistently in report cards and rows without inventing missing amounts", () => {
    expect(reportValue("collectedCents", 9500)).toBe("$95.00");
    expect(reportValue("collectedCents", null)).toBe("—");
    expect(reportValue("jobs", 4)).toBe("4");
    expect(reportValue("completionRate", 80)).toBe("80%");
    expect(reportValue("collectedCents", 9500, "EUR")).toBe("€95.00");
    expect(balanceTotals([{ currency: "USD", openBalanceCents: 100 }, { currency: "EUR", openBalanceCents: 200 }, { currency: "USD", openBalanceCents: 50 }]))
      .toEqual([{ currency: "USD", cents: 150 }, { currency: "EUR", cents: 200 }]);
  });

  it.each([
    ["/auth/login", 401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid credentials" }, "The email address or password is incorrect. Please try again."],
    ["/auth/register", 422, { code: "PASSWORD_TOO_SHORT", message: "internal password constraint" }, "Use a password with at least 8 characters."],
    ["/auth/register", 422, { code: "USER_ALREADY_EXISTS", message: "duplicate user" }, "An account with this email address already exists. Sign in instead."],
    ["/jobs", 409, { error: { code: "INVALID_TRANSITION", message: "Cannot move job from scheduled to completed" } }, "This action is no longer available. Refresh to see the current options."],
    ["/reports", 403, { error: { code: "CAPABILITY_UNAVAILABLE", message: "Add or enable this capability" } }, "This tool isn’t enabled in your business setup. A business owner can enable it."],
    ["/jobs", 500, { error: { code: "INTERNAL_ERROR", message: "SQL failure: session undefined" } }, "We couldn’t complete that action right now. Please try again shortly."],
  ])("provides plain recovery copy for %s (%s)", async (path, status, payload, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload, { status })));
    await expect(api(path)).rejects.toMatchObject({ message, status });
  });

  it("preserves machine conflict status, code and evidence details", async () => {
    const details = { expectedState: "dispatched", currentState: "completed" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "CONFLICT", message: "The job changed. Review it before retrying.", details } }, { status: 409 })));
    await expect(api("/field/jobs/job/transition")).rejects.toMatchObject({ status: 409, code: "CONFLICT", details, message: "The job changed. Review it before retrying." });
  });

  it("preserves useful plain service-availability feedback and adds a recovery step", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "Feedback is temporarily unavailable." } }, { status: 503 })));
    await expect(api("/portal/feedback/visit")).rejects.toMatchObject({ status: 503, message: "Feedback is temporarily unavailable. Please try again shortly." });
  });

  it("keeps network errors retryable without leaking fetch implementation messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/customers")).rejects.toThrow("We couldn’t reach the service. Check your connection and try again.");
  });

  it.each(["network", "invalid-success"])("preserves pending offline work after a %s response failure", async (failure) => {
    vi.stubGlobal("fetch", failure === "network" ? vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
      : vi.fn().mockResolvedValue(new Response("{bad", { headers: { "content-type": "application/json" } })));
    let queue: OfflineOperation[] = [{ id: "saved-id", path: "/field/time", createdAt: "2026-10-05T12:00:00Z", status: "pending", payload: { action: "clock_in" } }];
    await drainQueue({ read: () => queue, write: (items) => { queue = items; } }, (operation) => api(operation.path));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: "saved-id", status: "pending", payload: { action: "clock_in" } });
    expect(queue[0]?.error?.message).not.toMatch(/fetch|JSON|Unexpected/);
  });

  it.each([new Response("<html>proxy error</html>", { status: 502 }), new Response("{broken", { status: 500, headers: { "content-type": "application/json" } })])("handles non-JSON and malformed failures without technical text", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    try { await api("/customers"); throw new Error("Expected failure"); }
    catch (issue) { expect(issue).toBeInstanceOf(ApiError); expect((issue as Error).message).not.toMatch(/502|500|JSON|Unexpected|html/); }
  });

  it("does not promise highlighted fields that the form does not render", async () => {
    const failure = z.object({ name: z.string().min(2) }).safeParse({ name: "" });
    expect(failure.success).toBe(false);
    if (failure.success) return;
    expect(await apiError(failure.error).json()).toMatchObject({ error: { code: "VALIDATION_ERROR", message: "Check the information you entered and try again.", details: { fieldErrors: { name: expect.any(Array) } } } });
    expect(await apiError(new SyntaxError("Unexpected token")).json()).toMatchObject({ error: { message: "We couldn’t read this update. Please try again." } });
  });
});
