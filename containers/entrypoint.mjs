import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Encode PostgreSQL secret parts only at runtime, never in CloudFormation or logs. */
export function databaseEnvironment(env) {
  const keys = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USERNAME", "DB_PASSWORD"];
  if (!keys.some((key) => env[key])) return env;
  if (env.DATABASE_URL || keys.some((key) => !env[key])) throw new Error("Supply DATABASE_URL or complete DB_HOST/PORT/NAME/USERNAME/PASSWORD, not both");
  if (!/^\d+$/.test(env.DB_PORT) || Number(env.DB_PORT) < 1 || Number(env.DB_PORT) > 65535 || /[\s/:?#@]/.test(env.DB_HOST)) throw new Error("Invalid database host or port");
  if (env.DB_SSL !== undefined && !["true", "false"].includes(env.DB_SSL)) throw new Error("DB_SSL must be true or false");
  const url = new URL(`postgresql://${env.DB_HOST}:${env.DB_PORT}`);
  url.username = encodeURIComponent(env.DB_USERNAME);
  url.password = encodeURIComponent(env.DB_PASSWORD);
  url.pathname = `/${encodeURIComponent(env.DB_NAME)}`;
  if (env.DB_SSL === "true") url.searchParams.set("sslmode", "verify-full");
  return { ...env, DATABASE_URL: url.toString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (!command) throw new Error("Container command is required");
    const child = spawn(command, args, { stdio: "inherit", env: databaseEnvironment(process.env) });
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
    child.on("error", () => { console.error("Container process could not start"); process.exitCode = 1; });
    child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGTERM" ? 143 : 1); });
  } catch { console.error("Container database or command configuration is invalid"); process.exitCode = 1; }
}
