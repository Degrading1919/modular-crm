import { readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { expect, it } from "vitest";
import { buildProductionEntrypoints, validateRuntimeImports } from "../build.mjs";

it("builds production entrypoints with every external library directly declared and resolvable", async () => {
  // Inspect the identical emitted entrypoints in memory: migration-asset copying
  // and child-process startup are not part of the module-resolution contract.
  const result = await buildProductionEntrypoints({ write: false });
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const imports = validateRuntimeImports(result.metafile, manifest);
  const resolve = createRequire(new URL("dist/index.js", root));
  expect(imports).toContain("@aws-sdk/client-cloudfront");
  for (const path of imports) {
    expect(isBuiltin(path)).toBe(false);
    const packageName = path.startsWith("@") ? path.split("/").slice(0, 2).join("/") : path.split("/")[0];
    expect(manifest.dependencies[packageName], path).toBeDefined();
    expect(() => resolve.resolve(path), path).not.toThrow();
    const missing = { dependencies: { ...manifest.dependencies } };
    delete missing.dependencies[packageName];
    const firstMissingImport = imports.find(value => value === packageName || value.startsWith(`${packageName}/`));
    expect(() => validateRuntimeImports(result.metafile, missing)).toThrow(`Bundled runtime import ${firstMissingImport} must be a worker production dependency`);
  }
});
