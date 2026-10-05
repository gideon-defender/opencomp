#!/usr/bin/env node
/**
 * Re-apply the pnpm-native toolchain to the Speakeasy-generated MCP server.
 *
 * `speakeasy run` regenerates this directory from templates that assume
 * bun/npm (`bun i`, `import { build } from "bun"`, npm `overrides`). Run
 * this script after every regen so the project keeps working with pnpm and
 * without bun. Idempotent — safe to run when nothing needs changing.
 *
 * Usage: `node ./scripts/apply-pnpm-toolchain.mjs` (from apps/mcp-server)
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const writeJson = (path, value) =>
  writeFileSync(join(ROOT, path), `${JSON.stringify(value, null, 2)}\n`);

const CHANGED = [];
const note = (msg) => {
  CHANGED.push(msg);
  console.log(` - ${msg}`);
};

// 1. package.json: pnpm scripts, pnpm overrides, aligned versions, no bun.
{
  const pkg = readJson("package.json");

  const scripts = {
    build: "pnpm install --ignore-workspace && tsx ./src/mcp-server/build.mts && tsc",
    "mcpb:build":
      "pnpm install --ignore-workspace && tsx ./src/mcp-server/build.mts --pack && tsc",
    check: "pnpm run lint",
    lint: "eslint --cache --max-warnings=0 src",
    prepublishOnly: "pnpm run build",
  };
  for (const [name, cmd] of Object.entries(scripts)) {
    if (pkg.scripts?.[name] !== cmd) {
      pkg.scripts[name] = cmd;
      note(`script ${name} -> pnpm form`);
    }
  }

  // npm `overrides` -> pnpm `overrides` (pnpm reads them under `pnpm.overrides`).
  if (pkg.overrides) {
    pkg.pnpm = { ...(pkg.pnpm ?? {}), overrides: pkg.overrides };
    delete pkg.overrides;
    note("npm `overrides` moved to `pnpm.overrides`");
  }

  // Versions aligned with the monorepo (syncpack lint enforces these).
  const align = {
    dependencies: { zod: "^4.6.5" },
    devDependencies: {
      eslint: "^10.9.0",
      typescript: "^5.9.3",
      globals: "^17.3.0",
      "@types/node": "^24.2.0",
    },
  };
  for (const [group, entries] of Object.entries(align)) {
    for (const [dep, version] of Object.entries(entries)) {
      if (pkg[group]?.[dep] && pkg[group][dep] !== version) {
        pkg[group][dep] = version;
        note(`${group}.${dep} -> ${version}`);
      }
    }
  }

  // esbuild (bundler) + tsx (script runner) replace bun. Always present.
  pkg.devDependencies = pkg.devDependencies ?? {};
  for (const [dep, version] of Object.entries({ esbuild: "^0.25.0", tsx: "^4.19.0" })) {
    if (pkg.devDependencies[dep] !== version) {
      pkg.devDependencies[dep] = version;
      note(`devDependencies.${dep} -> ${version}`);
    }
  }
  for (const dep of ["bun", "@types/bun"]) {
    if (pkg.devDependencies[dep]) {
      delete pkg.devDependencies[dep];
      note(`removed devDependencies.${dep}`);
    }
  }

  writeJson("package.json", pkg);
}

// 2. Canonical key order (what `syncpack format` enforces). The regen
// template writes its own order, so normalize here instead of requiring a
// separate format pass.
{
  const ORDER = [
    "name",
    "version",
    "author",
    "bin",
    "dependencies",
    "devDependencies",
    "pnpm",
    "repository",
    "scripts",
    "sideEffects",
    "type",
  ];
  const pkg = readJson("package.json");
  const ordered = {};
  for (const key of ORDER) {
    if (pkg[key] !== undefined) ordered[key] = pkg[key];
  }
  for (const key of Object.keys(pkg)) {
    if (!(key in ordered)) ordered[key] = pkg[key];
  }
  if (JSON.stringify(Object.keys(ordered)) !== JSON.stringify(Object.keys(pkg))) {
    writeJson("package.json", ordered);
    note("package.json: normalized top-level key order");
  }
}

// 2. build.mts: esbuild instead of Bun.build (same bundle semantics).
{
  const path = "src/mcp-server/build.mts";
  let src = readFileSync(join(ROOT, path), "utf8");
  const before = src;
  src = src.replace(
    '/// <reference types="bun-types" />\n\nimport { build } from "bun";',
    'import { build } from "esbuild";',
  );
  src = src.replace(
    `  await build({
    entrypoints: [entrypoint],
    outdir: destinationDir,
    sourcemap: shouldPack ? "none" : "linked",
    target: "node",
    format: "esm",
    minify: shouldPack,
    throw: true,
    banner: "#!/usr/bin/env node",
  });`,
    `  await build({
    entryPoints: [entrypoint],
    bundle: true,
    outdir: destinationDir,
    sourcemap: shouldPack ? false : true,
    platform: "node",
    target: "node20",
    format: "esm",
    minify: shouldPack,
    banner: { js: "#!/usr/bin/env node" },
  });`,
  );
  if (src !== before) {
    writeFileSync(join(ROOT, path), src);
    note("build.mts: Bun.build -> esbuild");
  }
}

// 3. Generated-code compat: fresh templates assume @types/node 18, but the
// monorepo standard (and syncpack) requires @types/node 24, whose generic
// Uint8Array no longer satisfies DOM BlobPart. Runtime-neutral cast.
{
  const path = "src/mcp-server/shared.ts";
  const file = join(ROOT, path);
  if (existsSync(file)) {
    let src = readFileSync(file, "utf8");
    const before = src;
    src = src.replace(
      "return new Uint8Array(await new Blob(chunks).arrayBuffer());",
      "return new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer());",
    );
    if (src !== before) {
      writeFileSync(file, src);
      note("shared.ts: BlobPart cast for @types/node 24");
    }
  }
}

// 4. Housekeeping: no bun lockfile line, registry pin, no npm lockfile.
{
  const path = ".gitignore";
  if (existsSync(join(ROOT, path))) {
    const lines = readFileSync(join(ROOT, path), "utf8").split("\n");
    const kept = lines.filter((line) => line.trim() !== "bun.lock");
    if (kept.length !== lines.length) {
      writeFileSync(join(ROOT, path), kept.join("\n"));
      note(".gitignore: dropped bun.lock");
    }
  }
  const npmrc = join(ROOT, ".npmrc");
  if (!existsSync(npmrc)) {
    writeFileSync(npmrc, "registry=https://registry.npmjs.org/\n");
    note(".npmrc: restored public registry pin");
  }
  const packageLock = join(ROOT, "package-lock.json");
  if (existsSync(packageLock)) {
    rmSync(packageLock);
    note("removed package-lock.json (pnpm-lock.yaml is the lockfile)");
  }
}

console.log(CHANGED.length === 0 ? "Already pnpm-native, nothing to do." : `Done (${CHANGED.length} change(s)). Run \`pnpm install --ignore-workspace\` next.`);
