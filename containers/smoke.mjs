import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

// This is an isolated local/CI check, not deployment. No registry push or seed.
const prefix = `crm-smoke-${randomBytes(6).toString("hex")}`;
const names = { postgres: `${prefix}-db`, web: `${prefix}-web`, worker: `${prefix}-worker`, unsafe: `${prefix}-unsafe` };
const images = { web: process.env.SMOKE_WEB_IMAGE || "modular-crm:web", worker: process.env.SMOKE_WORKER_IMAGE || "modular-crm:worker", migrate: process.env.SMOKE_MIGRATE_IMAGE || "modular-crm:migrate" };
const env = { ...process.env, POSTGRES_USER: "smoke", POSTGRES_DB: "crm", POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
  NODE_ENV: "production", LOCAL_SMOKE_TEST: "true", MOCK_CONNECTORS: "false", DOMAIN_VERIFICATION_MODE: "dns",
  PLATFORM_BILLING_PROVIDER: "mock", PLATFORM_BILLING_PLANS_JSON: JSON.stringify([{ key: "container-fixture", name: "Isolated container fixture", seats: 10, capabilities: ["*"], prices: { USD: { monthly: 100 } } }]),
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), WEBHOOK_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  // Match the actual loopback hostname returned by docker port below. The Host
  // router intentionally does not expose the staff app on any other hostname.
  APP_BASE_URL: "http://127.0.0.1:3000", BETTER_AUTH_URL: "http://127.0.0.1:3000", PUBLIC_BASE_URL: "http://127.0.0.1:3000",
  SMTP_HOST: "smtp.invalid", SMTP_PORT: "587", SMTP_FROM: "smoke@example.invalid", WORKER_HEALTH_PORT: "3001",
};
env.DATABASE_URL = `postgresql://smoke:${env.POSTGRES_PASSWORD}@${names.postgres}:5432/crm`;
const secretValues = [env.POSTGRES_PASSWORD, env.BETTER_AUTH_SECRET, env.WEBHOOK_SECRET_ENCRYPTION_KEY, env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY, env.DATABASE_URL];
const sanitize = (text) => secretValues.reduce((result, value) => result.replaceAll(value, "[redacted]"), text);
function docker(args, allowFailure = false, timeout = 60_000) {
  const result = spawnSync("docker", args, { env, encoding: "utf8", timeout });
  if (!allowFailure && result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${sanitize(result.stderr || result.error?.message || "unknown error")}`);
  return result;
}
const options = Object.keys(env).filter((key) => ["PLATFORM_BILLING_PROVIDER", "PLATFORM_BILLING_PLANS_JSON", "DATABASE_URL", "NODE_ENV", "LOCAL_SMOKE_TEST", "MOCK_CONNECTORS", "DOMAIN_VERIFICATION_MODE", "BETTER_AUTH_SECRET", "WEBHOOK_SECRET_ENCRYPTION_KEY", "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY", "APP_BASE_URL", "BETTER_AUTH_URL", "PUBLIC_BASE_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "WORKER_HEALTH_PORT"].includes(key)).flatMap((key) => ["-e", key]);
// Bounded startup polling waits for a real condition, never repeats a failed test.
async function until(check, label) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Startup deadline exceeded: ${label}`);
}
async function status(url) { try { return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).status; } catch { return 0; } }
function url(name, port) {
  const mapping = docker(["port", name, `${port}/tcp`]).stdout.trim();
  return `http://${mapping}`;
}
try {
  docker(["info"]);
  docker(["network", "create", prefix]);
  docker(["run", "-d", "--name", names.postgres, "--network", prefix, "-e", "POSTGRES_USER", "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB", "postgres:17-alpine"]);
  await until(() => docker(["exec", names.postgres, "pg_isready", "-U", "smoke", "-d", "crm"], true).status === 0, "PostgreSQL");
  // Fresh schema is not silently created by web boot.
  docker(["run", "-d", "--name", names.web, "--network", prefix, "-p", "127.0.0.1::3000", ...options, images.web]);
  const web = url(names.web, 3000);
  await until(async () => (await status(`${web}/api/health/live`)) === 200, "web liveness");
  assert.equal(await status(`${web}/api/health/ready`), 503, "web must await migrations");
  const absent = docker(["exec", names.postgres, "psql", "-U", "smoke", "-d", "crm", "-Atc", "select to_regclass('public.jobs') is null"]).stdout.trim();
  assert.equal(absent, "t", "web must not auto-migrate");
  assert.notEqual(docker(["run", "--rm", images.migrate], true).status, 0, "missing DATABASE_URL must fail migration");
  docker(["run", "--rm", "--network", prefix, "-e", "DATABASE_URL", images.migrate]);
  docker(["run", "--rm", "--network", prefix, "-e", "DATABASE_URL", images.migrate]); // Applied journal is safe to replay.
  docker(["run", "-d", "--name", names.worker, "--network", prefix, "-p", "127.0.0.1::3001", ...options, images.worker]);
  const worker = url(names.worker, 3001);
  const workerHealthcheck = JSON.parse(docker(["image", "inspect", images.worker, "--format", "{{json .Config.Healthcheck.Test}}"]).stdout);
  assert.deepEqual(workerHealthcheck, ["CMD", "node", "containers/probe.mjs", "live", "worker"], "worker restart probe must use liveness, not database readiness");
  for (const [name, base] of [["web", web], ["worker", worker]]) {
    await until(async () => (await status(`${base}/api/health/ready`)) === 200, `${name} readiness`);
    for (const probe of ["live", "ready"]) assert.equal(await status(`${base}/api/health/${probe}`), 200);
    await until(() => docker(["inspect", "--format", "{{.State.Health.Status}}", names[name]]).stdout.trim() === "healthy", `${name} Docker HEALTHCHECK`);
    assert.equal(docker(["exec", names[name], "id", "-u"]).stdout.trim(), "1000", "runtime must be non-root");
    console.info(`${name}: liveness/readiness 200, non-root`);
  }
  const login = await fetch(`${web}/login`);
  assert.equal(login.status, 200);
  assert.equal((await fetch(`${web}/login`, { headers: { host: "unknown.example.test" } })).status, 404, "unknown Host must never serve the staff app");
  assert.equal((await fetch(`${web}/login`, { headers: { "x-website-host": "unknown.example.test", "x-website-origin-key": "forged" } })).status, 404, "forged website forwarding must never serve the staff app");
  const html = await login.text();
  assert.match(html, /Sign in/);
  const asset = html.match(/(?:src|href)="([^"\s]*\/_next\/static\/[^"\s]+)"/);
  assert.ok(asset, "login must reference real static assets");
  assert.equal(await status(new URL(asset[1].replaceAll("&amp;", "&"), web)), 200, "standalone static assets must be served");
  docker(["exec", names.worker, "node", "--input-type=module", "-e", "import {createRequire} from 'node:module';const r=createRequire(import.meta.url);try {r.resolve('tsx');process.exit(1)} catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}"]);
  for (const image of Object.values(images)) {
    const baked = JSON.parse(docker(["image", "inspect", image, "--format", "{{json .Config.Env}}"]).stdout);
    assert.ok(!baked.some((value) => /^(BETTER_AUTH_SECRET|DATABASE_URL|WEBHOOK_SECRET_ENCRYPTION_KEY|CONNECTOR_CREDENTIAL_ENCRYPTION_KEY)=/.test(value)), "no baked credentials");
  }
  // The exact built web entry point must fail closed, not merely a config helper.
  docker(["run", "-d", "--name", names.unsafe, "-e", "NODE_ENV=production", images.web]);
  const exit = docker(["wait", names.unsafe], false, 20_000).stdout.trim();
  assert.match(exit, /^[1-9]\d*$/, "unsafe web configuration must exit non-zero");
  console.info("Production container smoke passed: migrations isolated/replayable, four probes, login/static assets, no tsx/baked credentials, unsafe web refused.");
} catch (error) {
  for (const name of Object.values(names)) {
    const result = docker(["logs", "--tail", "30", name], true);
    console.error(sanitize(result.stdout + result.stderr));
  }
  throw error;
} finally {
  // Only uniquely named resources created by this invocation, never host services.
  for (const name of Object.values(names)) docker(["rm", "-f", name], true);
  docker(["network", "rm", prefix], true);
}
