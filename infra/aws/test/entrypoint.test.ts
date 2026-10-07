import { expect, it } from "vitest";
// @ts-expect-error Shared pure JavaScript container entry point; no AWS SDK or provider imports.
import { databaseEnvironment } from "../../../containers/entrypoint.mjs";
it("encodes generated password parts and verifies TLS without changing portable DATABASE_URL", () => {
  const env = { DB_HOST: "database.example.test", DB_PORT: "5432", DB_NAME: "crm", DB_USERNAME: "operator", DB_PASSWORD: "a@:/?#% secret", DB_SSL: "true" };
  const result = new URL(databaseEnvironment(env).DATABASE_URL);
  expect(decodeURIComponent(result.password)).toBe(env.DB_PASSWORD);
  expect(result.searchParams.get("sslmode")).toBe("verify-full");
  expect(databaseEnvironment({ DATABASE_URL: "postgresql://local/crm" })).toEqual({ DATABASE_URL: "postgresql://local/crm" });
  expect(() => databaseEnvironment({ DB_PASSWORD: "partial" })).toThrow("complete");
  expect(() => databaseEnvironment({ ...env, DATABASE_URL: "ambiguous" })).toThrow("not both");
});
