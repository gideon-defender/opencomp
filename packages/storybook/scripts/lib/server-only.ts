import fs from 'node:fs';
import path from 'node:path';

const SERVER_ONLY_PATTERNS = [
  /['"]use server['"]/,
  /from\s+['"]server-only['"]/,
  /from\s+['"]next\/headers['"]/,
  /from\s+['"]@db\/server['"]/,
  /from\s+['"]@\/lib\/api-server['"]/,
  /from\s+['"]@gideon-defender\/email['"]/,
];

const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveLocalImport({
  specifier,
  fromFile,
  appSrc,
}: {
  specifier: string;
  fromFile: string;
  appSrc: string;
}): string | null {
  let base: string | null = null;
  if (specifier.startsWith('@/')) base = path.join(appSrc, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  if (!base) return null;

  for (const candidate of [base, ...EXTENSIONS.map((ext) => `${base}${ext}`)]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * A component is unusable in Storybook when it — or anything it pulls in —
 * reaches server-only code (`use server`, `next/headers`, the Prisma client,
 * the server API client). Those modules crash the browser bundle, so follow
 * local imports a few levels deep instead of only checking the entry file.
 */
export function isServerOnly({
  file,
  appSrc,
  maxDepth = 4,
  seen = new Set<string>(),
}: {
  file: string;
  appSrc: string;
  maxDepth?: number;
  seen?: Set<string>;
}): boolean {
  if (seen.has(file) || maxDepth < 0) return false;
  seen.add(file);

  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }

  if (SERVER_ONLY_PATTERNS.some((pattern) => pattern.test(source))) return true;

  for (const match of source.matchAll(IMPORT_RE)) {
    const resolved = resolveLocalImport({ specifier: match[1], fromFile: file, appSrc });
    if (!resolved) continue;
    if (isServerOnly({ file: resolved, appSrc, maxDepth: maxDepth - 1, seen })) return true;
  }

  return false;
}
