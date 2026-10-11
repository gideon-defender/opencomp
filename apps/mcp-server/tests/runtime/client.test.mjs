import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { executeRequest } from '../../src/client.ts';
import { resolveApiCredential } from '../../src/credentials.ts';
import { tool } from './fixtures.mjs';

const apiKey = 'phase2-fake-key-never-a-real-secret';
async function withApi({ handle, run }) {
  const records = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const record = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString(),
    };
    records.push(record);
    await handle({ request, response, record });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await run({ serverUrl: `http://127.0.0.1:${server.address().port}`, records });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const execute = ({ name = 'get-tasks', input = {}, signal, ...options }) =>
  executeRequest({
    tool: tool(name),
    input,
    options: { apiKey, ...options },
    servers: ['http://127.0.0.1:1'],
    ...(signal ? { signal } : {}),
  });
const text = (result) => result.content[0].text;

test('serving apikey header takes precedence; disabling static auth never uses a fallback', () => {
  assert.equal(
    resolveApiCredential({
      headers: new Headers({ apikey: 'per-user' }),
      staticApiKey: 'local-only',
    }),
    'per-user',
  );
  assert.equal(
    resolveApiCredential({ headers: new Headers(), staticApiKey: 'local-only' }),
    'local-only',
  );
  assert.equal(
    resolveApiCredential({
      headers: new Headers(),
      staticApiKey: 'local-only',
      disableStaticAuth: true,
    }),
    '',
  );
});

test('committed mutation followed by gateway failure has exactly one request/effect, even with safe-read retries', async () => {
  let effects = 0;
  await withApi({
    handle: ({ response }) => {
      effects++;
      response.writeHead(502);
      response.end(apiKey);
    },
    run: async ({ serverUrl, records }) => {
      const result = await execute({
        name: 'create-connection',
        input: { request: { providerSlug: 'aws', credentials: { regions: ['us-east-2'] } } },
        serverUrl,
        safeReadRetries: 3,
      });
      assert.equal(result.isError, true);
      assert.equal(records.length, 1);
      assert.equal(effects, 1);
      assert.equal(records[0].headers['x-api-key'], apiKey);
      assert.deepEqual(JSON.parse(records[0].body).credentials, { regions: ['us-east-2'] });
      assert.match(text(result), /HTTP 502/);
      assert(!text(result).includes(apiKey));
      assert(!('idempotency-key' in records[0].headers));
    },
  });
});
test('all mutation methods make one attempt on ambiguous network failures', async () => {
  for (const method of ['post', 'put', 'patch', 'delete']) {
    let attempts = 0;
    const original = tool('get-tasks');
    const result = await executeRequest({
      tool: { ...original, method },
      input: {},
      servers: ['http://127.0.0.1:1'],
      options: {
        apiKey,
        safeReadRetries: 3,
        fetch: async () => {
          attempts++;
          throw new Error(`private ${apiKey}`);
        },
      },
    });
    assert.equal(attempts, 1);
    assert.equal(result.isError, true);
    assert(!text(result).includes(apiKey));
  }
});
test('reads do not retry by default; opted-in safe reads respect Retry-After', async () => {
  let hits = 0;
  await withApi({
    handle: ({ response }) => {
      hits++;
      response.writeHead(hits < 3 ? 429 : 200, {
        'retry-after': '0',
        'content-type': 'application/json',
      });
      response.end('{"ok":true}');
    },
    run: async ({ serverUrl, records }) => {
      assert.equal((await execute({ serverUrl })).isError, true);
      assert.equal(records.length, 1);
      const result = await execute({ serverUrl, safeReadRetries: 2 });
      assert.equal(records.length, 3);
      assert.equal(result.isError, undefined);
      assert.equal(text(result), '{"ok":true}');
    },
  });
});
test('safe reads have bounded attempts, and network failures are retryable only when opted in', async () => {
  let attempts = 0;
  const fetch = async () => {
    attempts++;
    return new Response('private', { status: 503, headers: { 'Retry-After': '0' } });
  };
  assert.equal((await execute({ fetch, safeReadRetries: 2 })).isError, true);
  assert.equal(attempts, 3);
  attempts = 0;
  const network = async () => {
    attempts++;
    if (attempts === 1) throw new Error('offline');
    return new Response('ok');
  };
  assert.equal(text(await execute({ fetch: network, safeReadRetries: 1 })), 'ok');
  assert.equal(attempts, 2);
});
test('one total deadline covers Retry-After backoff and never retries early', async () => {
  let attempts = 0;
  const start = Date.now();
  const result = await execute({
    timeoutMs: 35,
    safeReadRetries: 3,
    fetch: async () => {
      attempts++;
      return new Response('private', { status: 429, headers: { 'Retry-After': '10' } });
    },
  });
  assert.equal(attempts, 1);
  assert.match(text(result), /deadline/);
  assert(Date.now() - start < 1000);
});
test('caller cancellation covers requests and retry backoff', async () => {
  const controller = new AbortController();
  const fetch = async () => {
    controller.abort();
    return new Response('', { status: 503, headers: { 'Retry-After': '10' } });
  };
  assert.match(
    text(await execute({ fetch, signal: controller.signal, safeReadRetries: 3 })),
    /cancelled/,
  );
  let attempts = 0;
  assert.match(
    text(
      await execute({
        signal: controller.signal,
        fetch: async () => {
          attempts++;
          return new Response('');
        },
      }),
    ),
    /cancelled/,
  );
  assert.equal(attempts, 0);
});
test('deadline includes delayed response body consumption', async () => {
  await withApi({
    handle: ({ response }) => {
      response.writeHead(200);
      response.flushHeaders();
      response.write('partial');
    },
    run: async ({ serverUrl }) =>
      assert.match(text(await execute({ serverUrl, timeoutMs: 40 })), /deadline/),
  });
});
test('success text, image and audio formatting; errors and thrown exceptions do not expose credentials', async () => {
  assert.equal(
    text(await execute({ fetch: async () => new Response(`ok ${apiKey}`) })),
    'ok [REDACTED]',
  );
  for (const mime of ['image/png', 'audio/mpeg']) {
    const result = await execute({
      fetch: async () =>
        new Response(new Uint8Array([0, 1, 2]), { headers: { 'content-type': mime } }),
    });
    assert.equal(result.content[0].type, mime.startsWith('image') ? 'image' : 'audio');
    assert.equal(result.content[0].data, 'AAEC');
    assert.equal(result.content[0].mimeType, mime);
  }
  assert.equal(text(await execute({ fetch: async () => new Response(null, { status: 204 }) })), '');
});
test('concurrent calls isolate API keys, organization headers, and server/index overrides', async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({
      url: String(url),
      key: init.headers.get('X-API-Key'),
      org: init.headers.get('X-Organization-Id'),
    });
    return new Response('ok');
  };
  const body = { purpose: 'general', fileName: 'a', fileType: 'text/plain' };
  await Promise.all(
    ['one', 'two'].map((org) =>
      execute({
        name: 'create-upload-url',
        input: { request: { xOrganizationId: org, body } },
        apiKey: `key-${org}`,
        serverUrl: `http://127.0.0.1:1/${org}`,
        fetch,
      }),
    ),
  );
  assert.deepEqual(seen, [
    { url: 'http://127.0.0.1:1/one/v1/uploads/presign', key: 'key-one', org: 'one' },
    { url: 'http://127.0.0.1:1/two/v1/uploads/presign', key: 'key-two', org: 'two' },
  ]);
  await executeRequest({
    tool: tool('get-tasks'),
    input: {},
    servers: ['http://127.0.0.1:1', 'http://127.0.0.1:2'],
    options: { apiKey, fetch, serverIndex: 1 },
  });
  assert.equal(seen[2].url, 'http://127.0.0.1:2/v1/tasks');
});
test('redirects are not followed with credentials; invalid server/deadline/retry config makes no request', async () => {
  let calls = 0;
  const fetch = async (_, init) => {
    calls++;
    assert.equal(init.redirect, 'manual');
    return new Response('', { status: 302, headers: { location: 'https://example.invalid' } });
  };
  assert.equal((await execute({ fetch })).isError, true);
  assert.equal(calls, 1);
  for (const options of [
    { serverUrl: 'https://user:secret@example.invalid' },
    { timeoutMs: 0 },
    { safeReadRetries: 4 },
    { apiKey: '' },
    { serverIndex: 2 },
  ]) {
    assert.equal((await execute({ ...options, fetch })).isError, true);
  }
  assert.equal(calls, 1);
});
