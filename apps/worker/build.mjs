import { build } from "esbuild";
import { cp, readFile, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

// Compile workspace TypeScript into ESM; retain installed production libraries
// and their own runtime assets/module boundaries, never a development transpiler.
export function buildProductionEntrypoints({ write = true } = {}) {
  return build({
    absWorkingDir: fileURLToPath(new URL("./", import.meta.url)),
    entryPoints: { index: "src/index.ts", "migrate/index": "src/migrate.ts" },
    outdir: "dist", bundle: true, platform: "node", target: "node22", format: "esm", metafile: true, write,
    plugins: [{ name: "production-libraries", setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, (args) =>
        args.path.startsWith("@modular-crm/") ? undefined : { path: args.path, external: true });
    } }],
  });
}
// Workspace modules are bundled into this package's output. Their external
// imports therefore resolve from the worker, not the original workspace package.
// pnpm deploy preserves transitive libraries, but does not make them direct
// imports of this package. Fail the build before shipping an unresolved library.
export function validateRuntimeImports(metafile, manifest) {
  const runtimeImports = [...new Set(Object.values(metafile.outputs).flatMap(output => output.imports)
    .filter(value => value.external && !isBuiltin(value.path)).map(value => value.path))].sort();
  for (const path of runtimeImports) {
    const packageName = path.startsWith("@") ? path.split("/").slice(0, 2).join("/") : path.split("/")[0];
    assert.ok(manifest.dependencies?.[packageName], `Bundled runtime import ${path} must be a worker production dependency`);
  }
  return runtimeImports;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildProductionEntrypoints();
  const manifest = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  const runtimeImports = validateRuntimeImports(result.metafile, manifest);
  await writeFile(new URL("dist/runtime-imports.json", import.meta.url), JSON.stringify(runtimeImports, null, 2));
  await cp(new URL("../../packages/db/drizzle", import.meta.url), new URL("dist/drizzle", import.meta.url), { recursive: true });
}
