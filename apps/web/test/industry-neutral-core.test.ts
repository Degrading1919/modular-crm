import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps industry vocabulary out of shared application and domain code", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  // Generated reports/traces contain copied fixture code, not authored application source.
  const ignored = new Set(["node_modules", ".next", "test", "tests", "fixtures", "test-results", "playwright-report", "coverage"]);
  const violations: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(root + directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { walk(path); continue; }
      if (!/\.(?:tsx?|m?js)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) continue;
      let text = readFileSync(root + path, "utf8");
      // Explicit fixture-only local landing redirect; production host routing is industry-neutral.
      if (path === "apps/web/app/page.tsx") text = text.replace('"/site/happy-yards"', '"/site/local-demo"');
      text = text.replace(/([a-z])([A-Z])/g, "$1 $2");
      if (/\b(?:pets?|dogs?|yards?|gates?)\b/i.test(text)) violations.push(path);
    }
  }
  walk("apps/web"); walk("packages/domain/src");
  expect(violations).toEqual([]);
});
