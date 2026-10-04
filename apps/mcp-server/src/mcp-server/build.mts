import { zipSync } from 'fflate';
import { build } from 'esbuild';
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { createConsoleLogger } from './console-logger.ts';
import { createMCPServer } from './server.ts';

const shouldPack = process.argv.includes('--pack');

// Minimal .mcpb packer: a .mcpb bundle is a zip of the staged extension
// directory. This replaces packExtension from @anthropic-ai/mcpb, which
// pulled in node-forge (high-severity RSA verification CVE with no
// upstream fix) through its manifest-signing module. This unsigned pack
// never touches that path, so the dependency — and the CVE — stays out.
async function packExtension({
  extensionPath,
  outputPath,
}: {
  extensionPath: string;
  outputPath: string;
}): Promise<void> {
  const resolvedPath = resolve(extensionPath);
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(resolvedPath, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error(`Cannot pack extension without a readable manifest.json in ${extensionPath}`);
  }
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('Cannot pack extension: manifest.json must contain a JSON object');
  }
  const record = manifest as Record<string, unknown>;
  for (const field of ['manifest_version', 'name', 'version']) {
    if (typeof record[field] !== 'string' || (record[field] as string).length === 0) {
      throw new Error(`Cannot pack extension: manifest.json is missing required field "${field}"`);
    }
  }

  const files: Record<string, [Uint8Array, { os: 3; attrs: number }]> = {};
  const walk = async (dir: string): Promise<void> => {
    const names = await readdir(dir);
    names.sort();
    for (const name of names) {
      const full = join(dir, name);
      const st = await stat(full);
      if (st.isDirectory()) {
        await walk(full);
      } else {
        const key = relative(resolvedPath, full).split(sep).join('/');
        const data = await readFile(full);
        files[key] = [data, { os: 3 as const, attrs: (st.mode & 0o777) << 16 }];
      }
    }
  };
  await walk(resolvedPath);

  const zipData = zipSync(files, { level: 9, mtime: new Date() });
  const finalOutputPath = resolve(outputPath);
  await writeFile(finalOutputPath, zipData);
  console.log(`\n📦  ${record['name']}@${record['version']}`);
  console.log(`total files: ${Object.keys(files).length}`);
  console.log(`package size: ${zipData.length}B`);
  console.log(`\nOutput: ${finalOutputPath}`);
}

async function buildMcpServer() {
  // Explicitly create server to register tools
  const logger = createConsoleLogger('info');
  const { tools } = createMCPServer({ logger });

  // Iterate through all registered tools and add them to the manifest
  const manifest = await readFile('manifest.json', 'utf8');
  const manifestJson = JSON.parse(manifest);

  // remove previous
  manifestJson.tools = [];
  manifestJson.tools.push(
    ...tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
    })),
  );

  await writeFile('manifest.json', JSON.stringify(manifestJson, null, 2));
  const entrypoint = './src/mcp-server/mcp-server.ts';
  const destinationDir = './bin';

  // Generate tool-names.ts for the landing page
  const toolNamesContent = `// Auto-generated at build time
export const toolNames: Array<{ name: string; description: string }>= ${JSON.stringify(
    tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
    })),
    null,
    2,
  )};
`;
  await writeFile('./src/tool-names.ts', toolNamesContent);

  await build({
    entryPoints: [entrypoint],
    bundle: true,
    outfile: join(destinationDir, 'mcp-server.js'),
    sourcemap: shouldPack ? false : 'linked',
    platform: 'node',
    format: 'esm',
    minify: shouldPack,
    banner: { js: '#!/usr/bin/env node' },
  });

  // Set executable permissions on the output file
  const outputFile = join(destinationDir, 'mcp-server.js');
  await chmod(outputFile, 0o755);

  // Build the MCP bundle file
  if (shouldPack) {
    // Stage only the files needed for distribution to avoid bloated bundles.
    // Without this, packExtension would include node_modules and source files.
    const stageDir = '.mcpb-stage';
    await mkdir(join(stageDir, 'bin'), { recursive: true });
    await cp(join(destinationDir, 'mcp-server.js'), join(stageDir, 'bin', 'mcp-server.js'));
    await cp('manifest.json', join(stageDir, 'manifest.json'));

    // Copy icon and screenshot assets if they exist
    const assetExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    for (const file of await readdir('.')) {
      if (assetExts.some((ext) => file.toLowerCase().endsWith(ext))) {
        await cp(file, join(stageDir, file));
      }
    }

    await packExtension({
      extensionPath: stageDir,
      outputPath: './mcp-server.mcpb',
    });

    // Clean up staging directory
    await rm(stageDir, { recursive: true, force: true });
  }
}

await buildMcpServer().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
