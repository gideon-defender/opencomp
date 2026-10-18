import fs from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_FILE = /\.(test|spec|stories|d)\.tsx?$/;

export async function scanFiles({
  dir,
  pattern,
}: {
  dir: string;
  pattern: RegExp;
}): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await scanFiles({ dir: full, pattern })));
    } else if (pattern.test(entry.name) && !EXCLUDED_FILE.test(entry.name)) {
      results.push(full);
    }
  }
  return results.sort();
}

export function toPascalCase(fileName: string): string {
  return fileName
    .replace(/\.tsx?$/, '')
    .split(/[-._]/)
    .filter(Boolean)
    .map((part) => (/^[A-Z]/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** Relative module specifier usable in an import statement. */
export function toRelativeSpecifier({ from, to }: { from: string; to: string }): string {
  const relative = path
    .relative(from, to.replace(/\.tsx?$/, ''))
    .split(path.sep)
    .join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

export function extractRouteParams(filePath: string): string[] {
  return [...filePath.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
}
