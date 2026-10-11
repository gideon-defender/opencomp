import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FAKE_KEY = 'phase0-fake-credential-never-send';

export function assertLocalUrl(url) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'http:');
  assert.equal(parsed.hostname, '127.0.0.1', 'Probes require a loopback mock API');
  assert.equal(parsed.username, '');
  assert.equal(parsed.password, '');
}

export function childEnvironment(overrides = {}) {
  // Do not inherit real API keys, debug settings, or arbitrary secret variables.
  return { PATH: process.env.PATH ?? '', COMPAI_APIKEY: FAKE_KEY, ...overrides };
}

export async function startMockApi() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      apiKey: request.headers['x-api-key'],
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"phase0Mock":true}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

export function sourceCommand({ serverDir, args, apiUrl }) {
  assertLocalUrl(apiUrl);
  const directory = resolve(serverDir);
  return {
    command: process.execPath,
    args: [
      '--import',
      'tsx',
      resolve(directory, 'src/mcp-server/mcp-server.ts'),
      ...args,
      '--server-url',
      apiUrl,
    ],
    cwd: directory,
  };
}

export async function withStdioClient({ serverDir, args, apiUrl, env, run }) {
  const transport = new StdioClientTransport({
    ...sourceCommand({ serverDir, args, apiUrl }),
    env: childEnvironment(env),
    stderr: 'pipe',
  });
  // Drain stderr without printing potentially sensitive runtime diagnostics.
  const client = new Client({ name: 'phase0-harness', version: '1.0.0' });
  try {
    const connected = client.connect(transport, { timeout: 20000 });
    transport.stderr?.resume();
    await connected;
    return await run(client);
  } finally {
    await client.close();
    await transport.close();
  }
}

export async function listAllTools(client) {
  const tools = [];
  const cursors = new Set();
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (cursor) {
      assert(!cursors.has(cursor), 'Repeated pagination cursor');
      cursors.add(cursor);
    }
  } while (cursor);
  return tools;
}

export function toolText(result) {
  assert.notEqual(result.isError, true, 'MCP call failed');
  const block = result.content?.find((item) => item.type === 'text');
  assert(block && typeof block.text === 'string', 'Missing MCP text result');
  return block.text;
}

export async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const closed = once(server, 'close');
  server.close();
  await closed;
  return address.port;
}

export async function withHttpProcess({ serverDir, args, apiUrl, port, run }) {
  const command = sourceCommand({ serverDir, args: [...args, '--port', String(port)], apiUrl });
  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    env: childEnvironment(),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.resume();
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  const exited = new Promise((done) => child.once('close', done));
  const url = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 20000;
    let ready = false;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, 'MCP process exited before readiness');
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(500) });
        await response.body?.cancel();
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    assert(ready, 'MCP server readiness timed out');
    return await run(url);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function withClientTransport({ transport, run }) {
  const client = new Client({ name: 'phase0-transport-probe', version: '1.0.0' });
  try {
    await client.connect(transport, { timeout: 20000 });
    return await run(client);
  } finally {
    await client.close();
    await transport.close();
  }
}
