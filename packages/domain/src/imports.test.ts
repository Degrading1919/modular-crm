import { expect, it } from "vitest";
import { parseCsv, previewCustomerImport, importRowKey } from "./imports.ts";
import { signWebhook, verifyWebhook } from "./webhooks.ts";

it("parses quoted CSV and maps pet-waste columns with duplicate review", () => {
  expect(parseCsv('Name,Email,Notes\n"Carter, Ana",ana@example.test,"gate, side"')).toEqual([["Name", "Email", "Notes"], ["Carter, Ana", "ana@example.test", "gate, side"]]);
  const preview = previewCustomerImport("Customer Name,Email,Dog Name,Gate Code\nAna,ANA@EXAMPLE.TEST,Buddy,1234", [{ id: "c1", email: "ana@example.test" }]);
  expect(preview.mappings.map((mapping) => mapping.target)).toEqual(["name", "email", "petName", "gateCode"]);
  expect(preview.duplicates).toHaveLength(1);
  expect(importRowKey("batch", 2, preview.rows[0]!)).toBe(importRowKey("batch", 2, preview.rows[0]!));
});

it("rejects stale or altered webhook payloads", () => {
  const signature = signWebhook("secret", 1_000_000, '{"event":"job.completed"}');
  expect(() => verifyWebhook("secret", 1_000_000, '{"event":"job.completed"}', signature, 1_000_010)).not.toThrow();
  expect(() => verifyWebhook("secret", 1_000_000, '{"event":"job.skipped"}', signature, 1_000_010)).toThrow("signature");
  expect(() => verifyWebhook("secret", 1_000_000, '{"event":"job.completed"}', signature, 1_000_301)).toThrow("timestamp");
});
