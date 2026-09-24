import { expect, it, vi } from "vitest";
import { verifyWebhook } from "@modular-crm/domain";
import { deliverWebhookAttempt, isPublicWebhookAddress, matchesEventPattern, nextWebhookRetryAt, validateWebhookUrl, webhookBody } from "./webhook.js";

const event = { id: "event-1", tenantId: "tenant-a", eventType: "job.completed", eventVersion: 1, occurredAt: new Date("2026-09-23T12:00:00Z"), entityType: "job", entityId: "job-1", payload: { customerId: "customer-1", gateCode: "1234", nested: { accessInstructions: "back gate" } } };

it("matches exact and family webhook subscriptions", () => {
  expect(matchesEventPattern("job.completed", "job.*")).toBe(true);
  expect(matchesEventPattern("job.completed", "invoice.*")).toBe(false);
  expect(matchesEventPattern("job.completed", "job.completed")).toBe(true);
  expect(() => validateWebhookUrl("https://127.0.0.1/hook")).toThrow("private");
  expect(() => validateWebhookUrl("http://hooks.example.test/hook")).toThrow("HTTPS");
});
it("rejects private, metadata, and tunneled DNS answers before opening a socket", () => {
  for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "192.168.1.2", "100.64.0.3"]) {
    expect(isPublicWebhookAddress(address, 4)).toBe(false);
  }
  for (const address of ["::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2002:c0a8:101::1", "64:ff9b::a9fe:a9fe"]) {
    expect(isPublicWebhookAddress(address, 6)).toBe(false);
  }
  expect(isPublicWebhookAddress("8.8.8.8", 4)).toBe(true);
  expect(isPublicWebhookAddress("2606:4700:4700::1111", 6)).toBe(true);
});
it("signs a bounded, redacted outbound event and classifies retries", async () => {
  const now = new Date("2026-09-23T12:05:00Z");
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(init?.body).toBe(webhookBody(event));
    expect(String(init?.body)).not.toContain("1234");
    const headers = init?.headers as Record<string, string>;
    verifyWebhook("test-secret", Number(headers["x-modular-crm-timestamp"]), String(init?.body), headers["x-modular-crm-signature"], Math.floor(now.getTime() / 1000));
    return new Response("try again", { status: 503 });
  });
  const outcome = await deliverWebhookAttempt({ url: "https://hooks.example.test/receive", secret: "test-secret", event, now, fetcher: fetcher as typeof fetch });
  expect(outcome).toMatchObject({ success: false, responseStatus: 503, retryable: true });
  expect(nextWebhookRetryAt(2, now).toISOString()).toBe("2026-09-23T12:07:00.000Z");
});
