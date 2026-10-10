import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertLocalUrl, childEnvironment } from '../runtime.mjs';

export const binary = fileURLToPath(new URL('../../dist-owned/bin/mcp-server.js', import.meta.url));
export async function withStdio({
  args = ['start'],
  apiUrl,
  env = {},
  run,
  entrypoint = binary,
  cwd = tmpdir(),
}) {
  assertLocalUrl(apiUrl);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, ...args, '--server-url', apiUrl],
    env: childEnvironment(env),
    stderr: 'pipe',
    // Prove that the candidate never requires repository-relative data at runtime.
    cwd,
  });
  const client = new Client({ name: 'phase3-binary-tests', version: '1' });
  try {
    const connection = client.connect(transport, { timeout: 20000 });
    transport.stderr?.resume();
    await connection;
    return await run(client);
  } finally {
    await client.close();
    await transport.close();
  }
}
export async function withHttp({
  args,
  apiUrl,
  port,
  run,
  entrypoint = binary,
  cwd = tmpdir(),
  env = {},
}) {
  assertLocalUrl(apiUrl);
  const child = spawn(
    process.execPath,
    [entrypoint, ...args, '--server-url', apiUrl, '--port', String(port)],
    {
      env: childEnvironment(env),
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  child.stderr.resume();
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const url = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, 'Owned server exited before readiness');
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(500) });
        await response.body?.cancel();
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    assert(ready, 'Owned server readiness timed out');
    return await run(url);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
    try {
      await closed;
    } finally {
      clearTimeout(timer);
    }
  }
}
