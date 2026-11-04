#!/usr/bin/env node
/**
 * Prisma's prisma-client generator outputs .ts files with .js extension imports
 * (standard ESM convention). Turbopack in Next.js can't resolve .js→.ts cross-package.
 * This script rewrites .js imports to .ts in generated files.
 *
 * Usage: node fix-generated-extensions.js [dir]
 *   dir: path to generated prisma directory (default: ../src/generated/prisma relative to this script)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const generatedDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '../src/generated/prisma');

function fixExtensions(dir) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      fixExtensions(fullPath);
    } else if (entry.name.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      const updated = content
        .replace(/from '(\.[^']*)\.js'/g, "from '$1.ts'")
        .replace(/from "(\.[^"]*)\.js"/g, 'from "$1.ts"');
      if (updated !== content) {
        fs.writeFileSync(fullPath, updated);
      }
    }
  }
}

fixExtensions(generatedDir);
console.log(`[fix-extensions] Rewrote .js → .ts imports in ${generatedDir}`);
