import { packExtension } from '@anthropic-ai/mcpb';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { compileTools } from '../src/tools.ts';
import { releaseFingerprint } from './release-fingerprint.mjs';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: { pack: { type: 'boolean' }, 'out-dir': { type: 'string' } },
});
const shouldPack = values.pack === true;
const output = resolve(values['out-dir'] ?? resolve(packageDir, 'dist-owned'));
const specText = await readFile(resolve(packageDir, '../../packages/docs/openapi.json'), 'utf8');
const overlayText = await readFile(resolve(packageDir, 'mcp-overlay.yaml'), 'utf8');
const source = JSON.parse(specText);
const overlay = parse(overlayText);
const packageJson = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
const { tools } = compileTools({ source, overlay });
const toolNames = tools.map(({ name, description }) => ({ name, description }));
const manifest = JSON.parse(await readFile(resolve(packageDir, 'manifest.json'), 'utf8'));
manifest.tools = toolNames;
manifest.version = packageJson.version;
await mkdir(resolve(output, 'bin'), { recursive: true });
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(output, 'tool-names.json'), `${JSON.stringify(toolNames, null, 2)}\n`);
await writeFile(
  resolve(output, 'contract-revision.json'),
  `${JSON.stringify(
    {
      specSha256: createHash('sha256').update(specText).digest('hex'),
      overlaySha256: createHash('sha256').update(overlayText).digest('hex'),
      tools: tools.length,
      sourceSha256: await releaseFingerprint(),
    },
    null,
    2,
  )}\n`,
);
await build({
  absWorkingDir: packageDir,
  entryPoints: ['src/cli.ts'],
  outfile: resolve(output, 'bin/mcp-server.js'),
  tsconfig: resolve(packageDir, 'tsconfig.json'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  define: {
    __OPENCOMP_CONTRACT__: JSON.stringify({ source, overlay, version: packageJson.version }),
  },
  plugins: [
    {
      name: 'owned-tool-names',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/tool-names\.js$/ }, () => ({
          path: 'tool-names',
          namespace: 'owned',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'owned' }, () => ({
          contents: `export const toolNames=${JSON.stringify(toolNames)};`,
          loader: 'js',
        }));
      },
    },
  ],
});
await chmod(resolve(output, 'bin/mcp-server.js'), 0o755);
if (shouldPack) {
  // Keep the candidate self-contained; never pack the repository or node_modules.
  await packExtension({ extensionPath: output, outputPath: `${output}.mcpb`, silent: true });
}
console.log(`Owned candidate built: ${tools.length} tools (${output})`);
