import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_SERVER_DIR,
  FAKE_KEY,
  availablePort,
  startMockApi,
  withHttpProcess,
} from './runtime.mjs';

test('capture exits nonzero for invalid arguments without touching snapshots', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(DEFAULT_SERVER_DIR, 'tests/capture.mjs'), '--invalid'],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Only --update is supported/);
});

test('HTTP process is stopped even when a probe assertion fails', async () => {
  const mock = await startMockApi();
  const port = await availablePort();
  try {
    await assert.rejects(
      withHttpProcess({
        serverDir: DEFAULT_SERVER_DIR,
        apiUrl: mock.url,
        port,
        args: ['serve', '--apikey', FAKE_KEY],
        run: async () => {
          assert.fail('intentional probe assertion failure');
        },
      }),
      /intentional probe assertion failure/,
    );
    await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }));
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

test('failed HTTP startup rejects rather than leaving a child or waiting forever', async () => {
  const mock = await startMockApi();
  try {
    await assert.rejects(
      withHttpProcess({
        serverDir: DEFAULT_SERVER_DIR,
        apiUrl: mock.url,
        port: await availablePort(),
        args: ['serve', '--unrecognized-option'],
        run: async () => {
          assert.fail('must not reach the probe');
        },
      }),
      /MCP process exited before readiness/,
    );
  } finally {
    await mock.close();
  }
});
