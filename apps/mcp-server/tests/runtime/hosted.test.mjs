import express from 'express';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { parseCli } from '../../src/cli/flags.ts';
import { hostedAuth } from '../../src/cli/hosted.ts';

test('hosted flags require explicit HTTPS origins and disable all static credential fallback', () => {
  const args = [
    'serve',
    '--hosted',
    '--server-url',
    'https://api.example.com',
    '--public-url',
    'https://mcp.example.com',
  ];
  assert.equal(parseCli(args).disableStaticAuth, true);
  for (const invalid of [
    ['start', ...args.slice(1)],
    [...args, '--apikey', 'secret'],
    [...args, '--env', 'COMPAI_APIKEY=secret'],
    ['serve', '--hosted'],
    [...args, '--server-url', 'http://api.example.com'],
    [...args, '--public-url', 'https://user:secret@mcp.example.com'],
    [...args, '--public-url', 'https://mcp.example.com/path'],
  ])
    assert.throws(() => parseCli(invalid));
});

test('hosted gate rejects unauthenticated and cross-origin requests; API validates each key before tool discovery', async () => {
  const calls = [];
  let status = 200;
  let body = { authType: 'api-key' };
  const app = express();
  app.use(
    '/mcp',
    hostedAuth({
      apiUrl: 'https://api.example.com',
      publicUrl: 'https://mcp.example.com',
      fetchApi: async (url, options) => {
        calls.push({ url: String(url), options });
        if (status === 0) throw new Error('private connection details');
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      },
    }),
  );
  app.post('/mcp', (_req, res) => res.json({ allowed: true }));
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const url = `http://127.0.0.1:${listener.address().port}/mcp`;
  const request = (headers = {}) =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        url,
        { method: 'POST', headers: { host: 'mcp.example.com', ...headers } },
        (incoming) => {
          let body = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk) => {
            body += chunk;
          });
          incoming.on('end', () => resolve(new Response(body, { status: incoming.statusCode })));
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request({ authorization: 'Bearer other' })).status, 401);
    assert.equal(
      (await request({ apikey: 'key-a', origin: 'https://evil.example.com' })).status,
      403,
    );
    assert.equal((await request({ apikey: 'key-a', host: 'evil.example.com' })).status, 403);
    assert.equal(calls.length, 0);
    for (const key of ['key-a', 'key-b', 'key-a']) {
      assert.equal((await request({ apikey: key })).status, 200);
      assert.equal(calls.at(-1).options.headers['X-API-Key'], key);
      assert.equal(calls.at(-1).url, 'https://api.example.com/v1/auth/me');
      assert.equal(calls.at(-1).options.redirect, 'manual');
    }
    assert.equal(calls.length, 3);
    for (const upstream of [401, 403, 500, 302, 0]) {
      status = upstream;
      const response = await request({ apikey: 'revoked-secret' });
      assert.equal(response.status, [401, 403].includes(upstream) ? upstream : 503);
      assert(!(await response.text()).includes('secret'));
    }
    status = 200;
    body = { authType: 'session' };
    assert.equal((await request({ apikey: 'key-a' })).status, 503);
  } finally {
    listener.closeAllConnections();
    await new Promise((resolve) => listener.close(resolve));
  }
});
