import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { PGlite } from "../../../packages/db/node_modules/@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema, seedDevelopment, type Database } from "@modular-crm/db";

const { getDbMock, signInEmailMock } = vi.hoisted(() => ({ getDbMock: vi.fn(), signInEmailMock: vi.fn() }));
vi.mock("../lib/db.ts", () => ({ getDb: getDbMock }));
vi.mock("../lib/auth.ts", () => ({ auth: { api: { signInEmail: signInEmailMock, signUpEmail: vi.fn() } } }));

process.env.DATABASE_URL ??= "postgres://localhost:5433/modular_crm_test";
const { apiError } = await import("../lib/api/http.ts");
let handleAuthRoute: typeof import("../lib/api/auth-routes.ts").handleAuthRoute;
let handlePublicSite: typeof import("../lib/api/public-site.ts").handlePublicSite;
let handleSecureEstimateLink: typeof import("../lib/api/secure-estimate-links.ts").handleSecureEstimateLink;

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  // This suite simulates traffic delivered by one trusted ingress proxy.
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  await migrate(testDb, { migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)) });
  db = testDb as unknown as Database;
  getDbMock.mockReturnValue(db);
  signInEmailMock.mockImplementation(async (input: { body: { password: string } }) =>
    Response.json({ ok: input.body.password === "correct-password" }, { status: input.body.password === "correct-password" ? 200 : 401 }));
  await seedDevelopment(db);
  ({ handleAuthRoute } = await import("../lib/api/auth-routes.ts"));
  ({ handlePublicSite } = await import("../lib/api/public-site.ts"));
  ({ handleSecureEstimateLink } = await import("../lib/api/secure-estimate-links.ts"));
}, 120_000);

afterAll(async () => { await pglite?.close(); vi.unstubAllEnvs(); });

function request(path: string[], method = "GET", body?: unknown, ip = "198.51.100.201") {
  return new Request(`http://localhost/api/v1/${path.join("/")}`, {
    method,
    headers: {
      "x-forwarded-for": ip,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function send(path: string[], method = "GET", body?: unknown, ip?: string) {
  const currentRequest = request(path, method, body, ip);
  try {
    if (path[0] === "auth") return await handleAuthRoute(currentRequest, path);
    if (path[1] === "estimate-links") return await handleSecureEstimateLink(currentRequest, path) ?? new Response(null, { status: 404 });
    return await handlePublicSite(currentRequest, path) ?? new Response(null, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
}

async function sendMalformedAuth(path: string[], rawBody: string, ip: string) {
  const currentRequest = new Request(`http://localhost/api/v1/${path.join("/")}`, {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: rawBody,
  });
  try {
    return await handleAuthRoute(currentRequest, path);
  } catch (error) {
    return apiError(error);
  }
}

describe("public and authentication rate limits", () => {
  it("bounds one normalized account across twenty real address changes and both sign-in paths", async () => {
    const { handleAuthHttp } = await import("../lib/api/auth-http.ts");
    const handler = vi.fn(async () => new Response(null, { status: 401 }));
    for (let i = 0; i < 20; i++) {
      const email = i % 2 ? "ROTATING@example.test" : "rotating@example.test";
      const ip = `198.51.100.${i + 1}`;
      const response = i % 2 ? await send(["auth", "login"], "POST", { email, password: "wrong" }, ip)
        : await handleAuthHttp(request(["auth", "sign-in", "email"], "POST", { email, password: "wrong" }, ip), handler);
      expect(response.status).toBe(i < 10 ? 401 : 429);
      if (i >= 10) expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    }
    expect(handler).toHaveBeenCalledTimes(5);
  });
  it("bounds password reset across twenty changing addresses without sharing another account's budget", async () => {
    const { handleAuthHttp } = await import("../lib/api/auth-http.ts");
    const handler = vi.fn(async () => new Response(null, { status: 200 }));
    for (let i = 0; i < 20; i++) {
      const response = await handleAuthHttp(request(["auth", "request-password-reset"], "POST", { email: "reset-rotating@example.test" }, `203.0.113.${i + 1}`), handler);
      expect(response.status).toBe(i < 10 ? 200 : 429);
    }
    expect((await handleAuthHttp(request(["auth", "request-password-reset"], "POST", { email: "other-reset@example.test" }, "203.0.113.1"), handler)).status).toBe(200);
  });
  it("ignores rotating spoofed leftmost entries and a successful account cannot reset a different account", async () => {
    const blockedEmail = "spoofed@example.test", ip = "203.0.113.220";
    for (let i = 0; i < 5; i++) expect((await send(["auth", "login"], "POST", { email: blockedEmail, password: "wrong" }, `198.51.100.${i + 1}, ${ip}`)).status).toBe(401);
    expect((await send(["auth", "login"], "POST", { email: "successful@example.test", password: "correct-password" }, ip)).status).toBe(200);
    expect((await send(["auth", "login"], "POST", { email: blockedEmail, password: "wrong" }, `198.51.100.99, ${ip}`)).status).toBe(429);
  });
  it("shares credential budgets with direct Better Auth HTTP sign-in and bounds password reset", async () => {
    const { handleAuthHttp } = await import("../lib/api/auth-http.ts");
    const handler = vi.fn(async () => new Response(null, { status: 401 }));
    const ip = "198.51.100.240", email = "direct-auth@example.test";
    for (let i = 0; i < 3; i++) expect((await send(["auth", "login"], "POST", { email, password: "wrong" }, ip)).status).toBe(401);
    for (let i = 0; i < 2; i++) expect((await handleAuthHttp(request(["auth", "sign-in", "email"], "POST", { email, password: "wrong" }, ip), handler)).status).toBe(401);
    expect((await handleAuthHttp(request(["auth", "sign-in", "email"], "POST", { email, password: "wrong" }, ip), handler)).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await handleAuthHttp(request(["auth", "request-password-reset"], "POST", { email }, ip), handler)).status).toBe(401);
    const limited = await handleAuthHttp(request(["auth", "request-password-reset"], "POST", { email: email.toUpperCase() }, ip), handler);
    expect(limited.status).toBe(429); expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  it("does not fail open when shared credential storage fails", async () => {
    const { handleAuthHttp } = await import("../lib/api/auth-http.ts");
    const handler = vi.fn(async () => new Response(null, { status: 200 }));
    getDbMock.mockImplementationOnce(() => { throw new Error("storage unavailable"); });
    await expect(handleAuthHttp(request(["auth", "request-password-reset"], "POST", { email: "closed@example.test" }, "198.51.100.242"), handler)).rejects.toThrow("storage unavailable");
    expect(handler).not.toHaveBeenCalled();
  });
  it("bounds invalid sign-in attempts on the V1 route that calls Better Auth directly", async () => {
    const ip = "198.51.100.202";
    const body = { email: "nobody@example.test", password: "incorrect-password" };
    const attempts = [];
    for (let i = 0; i < 5; i += 1) attempts.push(await send(["auth", "login"], "POST", body, ip));
    expect(attempts.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);

    const blocked = await send(["auth", "login"], "POST", { ...body, email: "NOBODY@example.test" }, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    await expect(blocked.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("rate limits the V1 registration route before parsing malformed bodies", async () => {
    const ip = "198.51.100.206";
    const attempts = [];
    for (let i = 0; i < 300; i += 1) attempts.push(await sendMalformedAuth(["auth", "register"], "{", ip));
    expect(attempts.every((response) => response.status === 400)).toBe(true);

    const blocked = await sendMalformedAuth(["auth", "register"], "{", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("clears a failed-credential counter after successful sign-in", async () => {
    const ip = "198.51.100.207";
    const email = "reset-counter@example.test";
    for (let i = 0; i < 4; i += 1) {
      expect((await send(["auth", "login"], "POST", { email, password: "wrong-password" }, ip)).status).toBe(401);
    }
    expect((await send(["auth", "login"], "POST", { email, password: "correct-password" }, ip)).status).toBe(200);
    for (let i = 0; i < 5; i += 1) {
      expect((await send(["auth", "login"], "POST", { email, password: "wrong-password" }, ip)).status).toBe(401);
    }
    expect((await send(["auth", "login"], "POST", { email, password: "wrong-password" }, ip)).status).toBe(429);
  });

  it("allows many legitimate accounts behind one shared IP", async () => {
    const ip = "198.51.100.208";
    for (let i = 0; i < 25; i += 1) {
      const response = await send(["auth", "login"], "POST", {
        email: `office-user-${i}@example.test`, password: "correct-password",
      }, ip);
      expect(response.status).toBe(200);
    }
  });

  it("applies a broad per-IP ceiling across distinct email addresses", async () => {
    const ip = "198.51.100.209";
    for (let i = 0; i < 300; i += 1) {
      const response = await send(["auth", "login"], "POST", {
        email: `distinct-${i}@example.test`, password: "wrong-password",
      }, ip);
      expect(response.status).toBe(401);
    }
    expect((await send(["auth", "login"], "POST", {
      email: "distinct-301@example.test", password: "wrong-password",
    }, ip)).status).toBe(429);
  });

  it("bounds public signup submissions by action and client IP", async () => {
    const ip = "198.51.100.203";
    const body = {
      slug: "missing-rate-limit-signup-site", address: "12 Oak Street", zip: "30901",
      contact: { name: "Test Person", email: "test@example.test", phone: "555-0100" },
      service: { id: "weekly-yard", frequency: "weekly" },
      pets: [{ name: "Buddy", size: "medium" }], yard: { size: "medium" }, termsAccepted: true,
      idempotencyKey: "rate-limit-signup-test",
    };
    const attempts = [];
    for (let i = 0; i < 10; i += 1) attempts.push(await send(["public", "signup"], "POST", body, ip));
    expect(attempts.every((response) => response.status === 404)).toBe(true);

    const blocked = await send(["public", "signup"], "POST", body, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("bounds repeated quote calculations before site lookup", async () => {
    const ip = "198.51.100.204";
    const body = {
      slug: "missing-rate-limit-quote-site", address: "12 Oak Street", zip: "30901",
      serviceId: "weekly-yard", frequency: "weekly",
    };
    for (let i = 0; i < 40; i += 1) {
      expect((await send(["public", "quote"], "POST", body, ip)).status).toBe(404);
    }
    expect((await send(["public", "quote"], "POST", body, ip)).status).toBe(429);
  });

  it("bounds repeated requests to an estimate bearer link before token lookup", async () => {
    const token = "a".repeat(43);
    const ip = "198.51.100.205";
    for (let i = 0; i < 60; i += 1) {
      expect((await send(["public", "estimate-links", token], "GET", undefined, ip)).status).toBe(404);
    }
    const blocked = await send(["public", "estimate-links", token], "GET", undefined, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});
