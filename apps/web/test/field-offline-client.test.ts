import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../components/api";
import { serviceWorkerScript } from "../app/sw.js/route";

type EventData = {
  request?: { method: string; mode: string; url: string };
  data?: { type?: string; userId?: string; tenantId?: string; previousIdentity?: { userId: string; tenantId: string } };
  source?: { id: string };
  clientId?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
  respondWith?: (promise: Promise<Response>) => void;
};
type StoredCaches = Map<string, Map<string, Response>>;

function workerHarness(storedCaches: StoredCaches = new Map()) {
  const listeners = new Map<string, (event: EventData) => void>();
  let online = true;
  const fetcher = vi.fn(async (input: Request | string) => {
    if (!online) throw new TypeError("network is offline");
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/api/v1/field/")) return Response.json({ item: { id: "job-one", accessNotes: "Private gate code" } });
    return new Response(url.endsWith(".js") ? "static js" : "generic html", { headers: { "Content-Type": url.endsWith(".js") ? "text/javascript" : "text/html" } });
  });
  const cacheStorage = {
    open: async (name: string) => {
      if (!storedCaches.has(name)) storedCaches.set(name, new Map());
      const entries = storedCaches.get(name)!;
      return {
        put: async (request: Request | string, response: Response) => entries.set(typeof request === "string" ? request : request.url, response.clone()),
        match: async (request: Request | string) => entries.get(typeof request === "string" ? request : request.url)?.clone(),
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
        delete: async (request: Request | string) => entries.delete(typeof request === "string" ? request : request.url),
      };
    },
    keys: async () => [...storedCaches.keys()],
    delete: async (name: string) => storedCaches.delete(name),
  };
  const self = {
    location: { origin: "https://crm.test" },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener: (name: string, listener: (event: EventData) => void) => listeners.set(name, listener),
  };
  new Function("self", "caches", "fetch", "URL", "Request", "Response", serviceWorkerScript)(self, cacheStorage, fetcher, URL, Request, Response);
  return { listeners, storedCaches, fetcher, setOnline: (value: boolean) => { online = value; } };
}

async function sendIdentity(worker: ReturnType<typeof workerHarness>, clientId: string, userId: string, tenantId: string, previousIdentity?: { userId: string; tenantId: string }) {
  let handled!: Promise<unknown>;
  worker.listeners.get("message")!({
    source: { id: clientId },
    data: { type: "modular-crm-identity", userId, tenantId, previousIdentity },
    waitUntil: (promise) => { handled = promise; },
  });
  await handled;
}

async function fetchThroughWorker(worker: ReturnType<typeof workerHarness>, url: string, clientId: string, mode = "cors") {
  let response!: Promise<Response>;
  worker.listeners.get("fetch")!({
    request: { method: "GET", mode, url }, clientId,
    respondWith: (promise) => { response = promise; },
  });
  return response;
}

describe("field offline client safeguards", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("retains typed API conflict fields for the queue UI", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { code: "CONFLICT", message: "Job changed in the office.", details: { expectedPriorState: "scheduled", currentState: "canceled" } },
    }, { status: 409 })));
    await expect(api("/field/jobs/job-one/transition", { method: "POST", body: "{}" })).rejects.toMatchObject({
      name: "ApiError", status: 409, code: "CONFLICT", details: { expectedPriorState: "scheduled", currentState: "canceled" },
    });
    await expect(api("/field/jobs/job-one/transition", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(ApiError);
  });

  it("keeps the generic offline shell and static assets while excluding authenticated HTML and unrelated APIs", async () => {
    const worker = workerHarness();
    let installed!: Promise<unknown>;
    worker.listeners.get("install")!({ waitUntil: (promise) => { installed = promise; } });
    await installed;
    const shell = worker.storedCaches.get("modular-field-shell-v2")!;
    expect((await shell.get("/__modular_field_offline_shell__"))?.headers.get("content-type")).toContain("text/html");

    await fetchThroughWorker(worker, "https://crm.test/field/job/job-one", "client-one", "navigate");
    expect([...shell.keys()].some((url) => url.includes("/field/job/"))).toBe(false);
    const unrelatedApi = await fetchThroughWorker(worker, "https://crm.test/api/v1/customers", "client-one");
    expect(unrelatedApi).toBeUndefined();

    await fetchThroughWorker(worker, "https://crm.test/_next/static/chunks/field.js", "client-one");
    expect([...shell.keys()].some((url) => url.includes("/_next/static/chunks/field.js"))).toBe(true);
  });

  it("restores identity-scoped route data after worker restart and isolates another user", async () => {
    const firstWorker = workerHarness();
    await sendIdentity(firstWorker, "client-one", "tech-one", "tenant-one");
    const jobUrl = "https://crm.test/api/v1/field/jobs/job-one";
    expect((await fetchThroughWorker(firstWorker, jobUrl, "client-one")).status).toBe(200);
    expect(firstWorker.storedCaches.has("modular-field-data-v1:tenant-one:tech-one")).toBe(true);

    // A terminated worker loses its Map; the new instance restores the client identity from app-owned CacheStorage.
    const restarted = workerHarness(firstWorker.storedCaches);
    restarted.setOnline(false);
    const cachedJob = await fetchThroughWorker(restarted, jobUrl, "client-one");
    expect(cachedJob.status).toBe(200);
    expect((await cachedJob.json()).item.accessNotes).toBe("Private gate code");

    await sendIdentity(restarted, "client-two", "tech-two", "tenant-two");
    const otherUserJob = await fetchThroughWorker(restarted, jobUrl, "client-two");
    expect(otherUserJob.status).toBe(503);
    expect((await otherUserJob.json()).error.code).toBe("OFFLINE");
  });

  it("clears app-owned route caches on logout without deleting unrelated origin caches", async () => {
    const worker = workerHarness();
    worker.storedCaches.set("modular-field-shell-v2", new Map());
    worker.storedCaches.set("modular-field-data-v1:tenant-one:tech-one", new Map());
    worker.storedCaches.set("other-app-cache", new Map());
    let logout!: Promise<unknown>;
    worker.listeners.get("message")!({
      source: { id: "client-one" }, data: { type: "modular-crm-logout" },
      waitUntil: (promise) => { logout = promise; },
    });
    await logout;
    expect(worker.storedCaches.has("modular-field-shell-v2")).toBe(false);
    expect(worker.storedCaches.has("modular-field-data-v1:tenant-one:tech-one")).toBe(false);
    expect(worker.storedCaches.has("modular-field-client-identities-v1")).toBe(false);
    expect(worker.storedCaches.has("other-app-cache")).toBe(true);
  });
});
