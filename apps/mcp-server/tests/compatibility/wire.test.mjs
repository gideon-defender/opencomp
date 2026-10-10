import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { executeRequest } from '../../src/client.ts';
import { CompAiCore } from '../../src/core.ts';
import { registry } from '../runtime/fixtures.mjs';
import { sample } from './sample.mjs';

const ignoredHeaders = new Set([
  'host',
  'connection',
  'content-length',
  'user-agent',
  'accept-encoding',
  'accept-language',
  'sec-fetch-mode',
]);
test(
  'all 412 representative requests/results match the generated oracle against loopback, with fake credentials',
  { timeout: 120000 },
  async () => {
    const records = [];
    const api = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      records.push({
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(
          Object.entries(req.headers).filter(([key]) => !ignoredHeaders.has(key)),
        ),
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"phase3":true}');
    });
    await new Promise((resolve, reject) => {
      api.once('error', reject);
      api.listen(0, '127.0.0.1', resolve);
    });
    const serverUrl = `http://127.0.0.1:${api.address().port}`;
    const apiKey = 'phase3-fake-key';
    const client = new CompAiCore({
      security: { apikey: apiKey },
      serverURL: serverUrl,
      timeoutMs: 5000,
    });
    const legacy = new Map();
    const bodyDeltas = new Set([
      'exchange-code',
      'generate-auth-code',
      'register-device',
      'check-in',
      'parse-questionnaire',
      'save-answer',
      'delete-answer',
      'export-by-id',
      'save-manual-answer',
      'process-documents',
      'delete-all-manual-answers',
      'soa-save-answer',
      'create-document',
      'ensure-setup',
      'get-setup',
      'approve-document',
      'decline-document',
      'submit-for-approval',
      'export-document',
    ]);
    const seenBodyDeltas = new Set();
    try {
      for (const file of await readdir(new URL('../../src/mcp-server/tools/', import.meta.url))) {
        if (!file.endsWith('.ts')) continue;
        const module = await import(new URL(`../../src/mcp-server/tools/${file}`, import.meta.url));
        for (const value of Object.values(module))
          if (value && typeof value === 'object' && typeof value.tool === 'function')
            legacy.set(value.name, value);
      }
      const mismatches = [];
      for (const tool of registry.tools) {
        const input = sample(tool.staticInputSchema);
        const old = legacy.get(tool.name);
        assert(old, tool.name);
        const context = { signal: new AbortController().signal };
        const beforeResult = old.args
          ? await old.tool(client, input, context)
          : await old.tool(client, context);
        const afterResult = await executeRequest({
          tool,
          input,
          servers: [serverUrl],
          options: { apiKey },
        });
        assert.equal(
          records.length,
          2,
          `${tool.name}: both runtimes must make exactly one request`,
        );
        const [before, after] = records.splice(0);
        // Reviewed hygiene delta: do not send the generated SDK's empty Cookie header.
        if (before.headers.cookie === '' && after.headers.cookie === undefined)
          delete before.headers.cookie;
        if (bodyDeltas.has(tool.name)) {
          assert.equal(before.body, null, `${tool.name}: legacy omitted the body entirely`);
          assert.deepEqual(after.body, {}, `${tool.name}: owned runtime sends the declared object`);
          before.body = {};
          seenBodyDeltas.add(tool.name);
        }
        if (!isDeepStrictEqual(after, before)) mismatches.push({ tool: tool.name, before, after });
        if (!isDeepStrictEqual(afterResult, beforeResult))
          mismatches.push({ tool: tool.name, beforeResult, afterResult });
      }
      assert.deepEqual(mismatches, [], 'Unexpected per-operation wire/result deltas');
      assert.deepEqual(seenBodyDeltas, bodyDeltas, 'Stale wire delta allowlist');
    } finally {
      api.closeAllConnections();
      await new Promise((resolve) => api.close(resolve));
    }
  },
);
