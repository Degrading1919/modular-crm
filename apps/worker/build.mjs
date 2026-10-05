import { build } from "esbuild";
import { cp } from "node:fs/promises";

// Compile workspace TypeScript into ESM; retain installed production libraries
// and their own runtime assets/module boundaries, never a development transpiler.
await build({
  entryPoints: { index: "src/index.ts", "migrate/index": "src/migrate.ts" },
  outdir: "dist", bundle: true, platform: "node", target: "node22", format: "esm",
  plugins: [{ name: "production-libraries", setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith("@modular-crm/") ? undefined : { path: args.path, external: true });
  } }],
});
await cp("../../packages/db/drizzle", "dist/drizzle", { recursive: true });
