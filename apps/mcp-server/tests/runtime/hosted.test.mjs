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

test('hosted gate binds Gideon bearer to a dedicated MCP client and active tenant', async () => {
  const calls = [];
  let identity = {
    authType: 'gideon',
    user: { id: 'linked-user' },
    tenantId: 'tenant-one',
    organizations: [{ id: 'tenant-one' }],
  };
  const token = (claims) =>
    [
      'eyJhbGciOiJFUzI1NiJ9',
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      'signature',
    ].join('.');
  const valid = token({
    azp: 'mcp-client',
    aud: ['gideon-cockpit', 'mcp-client', 'https://mcp.example.com/mcp'],
    tenant_id: 'tenant-one',
  });
  const app = express();
  app.use(
    '/mcp',
    hostedAuth({
      apiUrl: 'https://api.example.com',
      publicUrl: 'https://mcp.example.com',
      oidcClientId: 'mcp-client',
      sharedAudience: 'gideon-cockpit',
      fetchApi: async (_url, options) => {
        calls.push(options);
        return new Response(JSON.stringify(identity), { status: 200 });
      },
    }),
  );
  app.post('/mcp', (_req, res) => res.json({ allowed: true }));
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const request = async (bearer, extra = {}) => {
    const url = `http://127.0.0.1:${listener.address().port}/mcp`;
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        url,
        {
          method: 'POST',
          headers: { host: 'mcp.example.com', authorization: `Bearer ${bearer}`, ...extra },
        },
        (incoming) => {
          incoming.resume();
          incoming.on('end', () => resolve(incoming.statusCode));
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
  };
  try {
    assert.equal(await request(valid), 200);
    assert.deepEqual(calls.at(-1).headers, { Authorization: `Bearer ${valid}` });
    for (const claim of ['tid', 'tenant_id', 'organizationId', 'tenantId', 'custom_tid']) {
      assert.equal(
        await request(
          token({
            azp: 'mcp-client',
            aud: ['gideon-cockpit', 'mcp-client', 'https://mcp.example.com/mcp'],
            [claim]: 'tenant-one',
          }),
        ),
        200,
        `API-validated ${claim} must be accepted`,
      );
    }
    assert.equal(
      await request(
        token({
          azp: 'other-client',
          aud: ['gideon-cockpit', 'mcp-client', 'https://mcp.example.com/mcp'],
          tenant_id: 'tenant-one',
        }),
      ),
      401,
    );
    assert.equal(
      await request(token({ azp: 'mcp-client', aud: 'gideon-cockpit', tenant_id: 'tenant-one' })),
      401,
    );
    assert.equal(
      await request(
        token({
          azp: 'mcp-client',
          aud: ['gideon-cockpit', 'mcp-client'],
          tenant_id: 'tenant-one',
        }),
      ),
      401,
    );
    identity = { ...identity, tenantId: 'tenant-two' };
    assert.equal(
      await request(
        token({
          azp: 'mcp-client',
          aud: ['gideon-cockpit', 'mcp-client', 'https://mcp.example.com/mcp'],
          tenant_id: 'tenant-two',
        }),
      ),
      401,
      'valid audiences must not bypass tenant membership',
    );
    for (const tenantId of [undefined, null, '', ' ']) {
      identity = { ...identity, tenantId };
      assert.equal(await request(valid), 401, 'the API must provide a resolved tenant');
    }
    identity = { ...identity, tenantId: 'tenant-one' };
    assert.equal(await request(valid, { apikey: 'another-identity' }), 401);
    identity = {
      authType: 'session',
      user: { id: 'linked-user' },
      organizations: [{ id: 'tenant-one' }],
    };
    assert.equal(await request(valid), 401);
  } finally {
    listener.closeAllConnections();
    await new Promise((resolve) => listener.close(resolve));
  }
});

test('hosted bearer mode refuses a client ID equal to the shared API audience', async () => {
  let calls = 0;
  const app = express();
  app.use(
    '/mcp',
    hostedAuth({
      apiUrl: 'https://api.example.com',
      publicUrl: 'https://mcp.example.com',
      oidcClientId: 'gideon-cockpit',
      sharedAudience: 'gideon-cockpit',
      fetchApi: async () => {
        calls++;
        return new Response('{}');
      },
    }),
  );
  app.post('/mcp', (_req, res) => res.sendStatus(200));
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  try {
    const status = await new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        `http://127.0.0.1:${listener.address().port}/mcp`,
        { method: 'POST', headers: { host: 'mcp.example.com', authorization: 'Bearer x.y.z' } },
        (incoming) => {
          incoming.resume();
          incoming.on('end', () => resolve(incoming.statusCode));
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
    assert.equal(status, 401);
    assert.equal(calls, 0);
  } finally {
    listener.closeAllConnections();
    await new Promise((resolve) => listener.close(resolve));
  }
});
