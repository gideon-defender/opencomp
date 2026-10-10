import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function sortedTools(tools) {
  return [...tools].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

export function parseDescriptions({ text, names }) {
  const schemas = {};
  for (const name of names) {
    const opening = `<input_schema tool="${name}">`;
    const start = text.indexOf(opening);
    assert(start >= 0, `Missing dynamic schema: ${name}`);
    const end = text.indexOf('</input_schema>', start);
    assert(end >= 0, `Unclosed dynamic schema: ${name}`);
    const body = text.slice(start + opening.length, end).trim();
    schemas[name] =
      body === 'This tool takes no input parameters.'
        ? { noInputParameters: true }
        : JSON.parse(body);
  }
  return schemas;
}

export function mapOperations(spec) {
  const operations = new Map();
  const methods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      const name = operation['x-speakeasy-mcp']?.name;
      if (!name) continue;
      assert(!operations.has(name), `Duplicate spec tool name: ${name}`);
      operations.set(name, {
        operationId: operation.operationId,
        method,
        path,
        summary: operation.summary,
        description: operation.description,
      });
    }
  }
  return operations;
}

export function assembleFixture({ serverDir, tools }) {
  const specPath = resolve(serverDir, '../../packages/docs/openapi.json');
  const spec = readJson(specPath);
  const operations = mapOperations(spec);
  assert.equal(
    new Set(tools.map((tool) => tool.name)).size,
    tools.length,
    'Duplicate live tool name',
  );
  return {
    generatedBy: 'phase0 harness (MCP SDK client, tools/list over stdio) + openapi.json mapping',
    gitHEAD: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: serverDir,
      encoding: 'utf8',
    }).trim(),
    spec: {
      version: spec.info.version,
      paths: Object.keys(spec.paths).length,
      sha256: hashFile(specPath),
    },
    binary: {
      sha256: hashFile(resolve(serverDir, 'bin/mcp-server.js')),
      note: 'committed esbuild bundle crashes on start/serve (Dynamic require of path); fixtures captured via tsx from identical source',
    },
    counts: { tools: tools.length },
    tools: sortedTools(tools).map((tool) => {
      assert(tool.inputSchema, `Missing static schema: ${tool.name}`);
      const envelope = operations.get(tool.name);
      assert(envelope, `No spec mapping for tool: ${tool.name}`);
      return { ...tool, envelope };
    }),
  };
}

export function verifyFixture({ actual, expected }) {
  assert.deepEqual(actual, expected, 'Parity fixture drift; review before updating the baseline');
}
