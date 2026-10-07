import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { ConnectorError } from "./types.ts";
import { createS3StorageDefinition } from "./s3-storage.ts";

type Stored = { body: Uint8Array; contentType: string };

it("refreshes temporary credentials before expiry and signs session tokens", async () => {
  const initial = Date.parse("2026-10-07T01:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(initial);
  try {
    const handler = makeHandler();
    const provider = vi.fn(async () => ({ accessKeyId: `temporary-${provider.mock.calls.length}`, secretAccessKey: "fixture-secret",
      sessionToken: `session-${provider.mock.calls.length}`, expiration: new Date(Date.now() + 60 * 60 * 1000) }));
    const definition = createS3StorageDefinition({ endpoint: "https://objects.example.test", bucket: "crm-files", region: "us-east-1",
      credentialMode: "task-role", credentials: provider, requestHandler: handler.requestHandler as never, now: () => new Date() });
    const scope = definition.createConfiguredScope!({ tenantId: "tenant-role", credentials: {}, now: () => new Date(), ensureAvailable: () => {} });
    const storage = scope.storage!;
    await storage.putObject({ key: "one.txt", content: new Uint8Array([1]), contentType: "text/plain" });
    const cachedCalls = provider.mock.calls.length;
    const firstToken = handler.requests.at(-1)!.headers["x-amz-security-token"];
    await storage.getObject("one.txt");
    expect(provider).toHaveBeenCalledTimes(cachedCalls);
    vi.setSystemTime(initial + 56 * 60 * 1000);
    await storage.getObject("one.txt");
    expect(provider.mock.calls.length).toBeGreaterThan(cachedCalls);
    expect(handler.requests.at(-1)!.headers["x-amz-security-token"]).not.toBe(firstToken);
    const link = await storage.createDownloadLink("one.txt", new Date(Date.now() + 60_000).toISOString());
    expect(new URL(link).searchParams.get("X-Amz-Security-Token")).toBe(handler.requests.at(-1)!.headers["x-amz-security-token"]);
  } finally { vi.useRealTimers(); }
});

function makeHandler() {
  const objects = new Map<string, Stored>();
  const requests: Array<{ method: string; path: string; headers: Record<string, string | string[] | undefined> }> = [];
  const requestHandler = {
    async handle(request: { method: string; path: string; headers: Record<string, string | string[] | undefined>; body?: Uint8Array }) {
      requests.push({ method: request.method, path: request.path, headers: request.headers });
      const key = decodeURIComponent(request.path.split("/").slice(2).join("/"));
      if (request.method === "PUT") {
        objects.set(key, { body: new Uint8Array(request.body ?? []), contentType: String(request.headers["content-type"] ?? "") });
        return { response: { statusCode: 200, headers: {}, body: Readable.from([]) } };
      }
      if (request.method === "GET") {
        const stored = objects.get(key);
        if (!stored) return { response: { statusCode: 404, headers: {}, body: Readable.from(["<Error><Code>NoSuchKey</Code></Error>"]) } };
        return { response: { statusCode: 200, headers: { "content-type": stored.contentType }, body: Readable.from([Buffer.from(stored.body)]) } };
      }
      if (request.method === "HEAD") {
        if (!objects.has(key)) return { response: { statusCode: 404, headers: {}, body: Readable.from([]) } };
        return { response: { statusCode: 200, headers: {}, body: Readable.from([]) } };
      }
      if (request.method === "DELETE") {
        objects.delete(key);
        return { response: { statusCode: 204, headers: {}, body: Readable.from([]) } };
      }
      throw new Error("unexpected handler request");
    },
    destroy() {},
  };
  return { objects, requests, requestHandler };
}

function connect(tenantId: string, requestHandler: ReturnType<typeof makeHandler>["requestHandler"], now: () => Date) {
  const definition = createS3StorageDefinition({
    endpoint: "https://objects.example.test",
    bucket: "crm-files",
    region: "us-east-1",
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
    signingSecret: "test-signing-secret",
    now,
    requestHandler: requestHandler as never,
  });
  const scope = definition.createConfiguredScope!({
    tenantId,
    credentials: {},
    now,
    ensureAvailable: () => {},
  });
  return scope.storage!;
}

describe("S3-compatible storage adapter", () => {
  it("puts, reads, and deletes objects beneath a tenant-only prefix", async () => {
    const handler = makeHandler();
    const now = () => new Date("2026-09-24T12:00:00.000Z");
    const tenantA = connect("tenant-a", handler.requestHandler, now);
    const tenantB = connect("tenant-b", handler.requestHandler, now);
    const content = new Uint8Array([4, 8, 15, 16, 23, 42]);

    await expect(tenantA.putObject({ key: "invoices/one.pdf", content, contentType: "application/pdf" }))
      .resolves.toEqual({ key: "invoices/one.pdf", size: content.length });
    expect((await tenantA.getObject("invoices/one.pdf"))?.content).toEqual(content);
    expect(await tenantB.getObject("invoices/one.pdf")).toBeUndefined();
    await tenantA.deleteObject("invoices/one.pdf");
    expect(await tenantA.getObject("invoices/one.pdf")).toBeUndefined();
    expect(handler.requests.filter((request) => request.method === "PUT")[0]?.path)
      .toMatch(/^\/crm-files\/tenants\/[a-f0-9]{64}\/invoices\/one\.pdf$/);
  });

  it("creates signed URLs and allows scoped retrieval only for links it issued before expiry", async () => {
    const handler = makeHandler();
    let instant = new Date("2026-09-24T12:00:00.000Z");
    const now = () => instant;
    const tenantA = connect("tenant-a", handler.requestHandler, now);
    const tenantB = connect("tenant-b", handler.requestHandler, now);
    await tenantA.putObject({ key: "private/report.csv", content: new Uint8Array([1, 2]), contentType: "text/csv" });

    const link = await tenantA.createDownloadLink("private/report.csv", "2026-09-24T12:15:00.000Z");
    const url = new URL(link);
    expect(url.searchParams.has("X-Amz-Signature")).toBe(true);
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBe(900);
    await expect(tenantA.getObjectByDownloadLink(link)).resolves.toMatchObject({ content: new Uint8Array([1, 2]), contentType: "text/csv" });
    await expect(tenantB.getObjectByDownloadLink(link)).rejects.toMatchObject({ code: "invalid_request" });
    instant = new Date("2026-09-24T12:15:00.000Z");
    await expect(tenantA.getObjectByDownloadLink(link)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects unsafe keys, invalid content types, and invalid link lifetimes", async () => {
    const handler = makeHandler();
    const now = () => new Date("2026-09-24T12:00:00.000Z");
    const storage = connect("tenant-a", handler.requestHandler, now);
    for (const key of ["../escape", "a/../b", "/absolute", "a\\b", "a//b", ""])
      await expect(storage.getObject(key)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(storage.putObject({ key: "valid/file", content: new Uint8Array(), contentType: "text/plain\r\nX-Evil: yes" }))
      .rejects.toMatchObject({ code: "invalid_request" });
    await expect(storage.createDownloadLink("missing/file", "2026-09-24T11:59:59.000Z"))
      .rejects.toMatchObject({ code: "invalid_request" });
    await expect(storage.createDownloadLink("missing/file", "2026-10-03T12:00:00.000Z"))
      .rejects.toMatchObject({ code: "invalid_request" });
    await expect(storage.createDownloadLink("missing/file", "2026-09-24T12:15:00.000Z"))
      .rejects.toMatchObject({ code: "invalid_request" });
  });

  it("sanitizes provider failures without exposing response content or credentials", async () => {
    const badHandler = {
      async handle() { throw new Error("secret-access-key and private provider response"); },
      destroy() {},
    };
    const storage = connect("tenant-a", badHandler as never, () => new Date("2026-09-24T12:00:00.000Z"));
    let error: unknown;
    try { await storage.putObject({ key: "doc.txt", content: new Uint8Array([1]), contentType: "text/plain" }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as Error).message).toBe("File storage is temporarily unavailable.");
    expect((error as Error).message).not.toContain("secret-access-key");
  });
});
