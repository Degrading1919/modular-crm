import { afterEach, expect, it, vi } from "vitest";
import { observeRequest, OtlpErrorReporter, safeLogFields, requestContext, withRequestContext, identifyTenant, logJson, reportFailure } from "./observability.ts";
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("redacts arbitrary fields, raw exceptions, bodies, PII, headers and bearer URLs by allowlist", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  withRequestContext({ requestId: id, route: "api.v1" }, () => {
    identifyTenant(id);
    logJson("error", "request.failed", { password: "secret", token: "bearer", cardNumber: "4242424242424242", email: "customer@example.test", body: "Private email body", error: new Error("SQL with secret"), route: "/token?secret=xyz", status: 500 });
  });
  const line = log.mock.calls[0]![0] as string;
  expect(JSON.parse(line)).toMatchObject({ requestId: id, tenantId: id, route: "api.v1", status: 500, level: "error" });
  for (const text of ["secret", "bearer", "424242", "customer@", "Private", "SQL"]) expect(line).not.toContain(text);
  expect(safeLogFields({ requestId: "not-a-uuid", tenantId: "PII", email: "unsafe" })).toEqual({});
  expect(safeLogFields({ configurationKeys: ["BETTER_AUTH_SECRET", "PRIVATE_PASSWORD_VALUE", "Jane Doe"] })).toEqual({ configurationKeys: ["BETTER_AUTH_SECRET"] });
});
it("echoes a safe request ID on success and expected errors without reporting 4xx", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const response = await observeRequest(new Request("http://localhost/?token=private", { headers: { "x-request-id": id } }), "api.v1", async () => {
    expect(requestContext()?.requestId).toBe(id);
    return Response.json({ error: "Expected" }, { status: 422 });
  });
  expect(response.headers.get("x-request-id")).toBe(id);
  expect(log.mock.calls.map(c => JSON.parse(c[0] as string).event)).toEqual(["request.completed"]);
  expect(requestContext()).toBeUndefined();
});
it("replaces unsafe inbound IDs and reports swallowed and thrown API 5xx exactly once", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  for (const work of [async () => new Response(null, { status: 503 }), async (): Promise<Response> => { throw new Error("password=private"); }]) {
    log.mockClear();
    const response = await observeRequest(new Request("http://localhost", { headers: { "x-request-id": "customer@example.test" } }), "api.v1", work);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(log.mock.calls.filter(c => JSON.parse(c[0] as string).event === "error.reported")).toHaveLength(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  }
});
it("keeps concurrent request contexts separate", async () => {
  const second = "22222222-2222-4222-8222-222222222222";
  await Promise.all([id, second].map(requestId => withRequestContext({ requestId, route: "test" }, async () => { await Promise.resolve(); expect(requestContext()?.requestId).toBe(requestId); })));
});
it("exports only safe metadata as OTLP JSON, using collector-neutral HTTP", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
  const reporter = new OtlpErrorReporter("https://collector.example.test/v1/logs", send);
  await withRequestContext({ requestId: id, route: "api.v1", tenantId: id }, () => reporter.report(new Error("card=424242"), { errorCode: "unhandled_api_error", status: 500, durationMs: 12 }));
  expect(send.mock.calls[0]![0]).toBe("https://collector.example.test/v1/logs");
  const payload = String(send.mock.calls[0]![1]!.body);
  expect(payload).toContain(id); expect(payload).not.toContain("424242");
  const record = JSON.parse(payload).resourceLogs[0].scopeLogs[0].logRecords[0];
  expect(record.severityNumber).toBe(17); expect(record.timeUnixNano).toMatch(/^\d+$/);
});
it("keeps reporting outages from changing the business outcome or leaking collector errors", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const send = vi.fn<typeof fetch>().mockRejectedValue(new Error("private collector credential"));
  await expect(reportFailure(new Error("private customer record"), { errorCode: "worker_job_failed", status: 500, durationMs: 1 }, new OtlpErrorReporter("https://collector.example/v1/logs", send))).resolves.toBeUndefined();
  expect(log.mock.calls).toHaveLength(1);
  expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ level: "warn", event: "error.reporter_unavailable" });
  expect(JSON.stringify(log.mock.calls)).not.toContain("private");
});
