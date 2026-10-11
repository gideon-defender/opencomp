import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { serializeRequest } from './request/serialize.js';
import type { CompiledTool } from './tools.js';

export type ApiOptions = {
  apiKey: string;
  serverUrl?: string;
  serverIndex?: number;
  /** Explicit opt-in only; the caller must know the GET/HEAD operation is safe. */
  safeReadRetries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function retryDelay({ response, attempt }: { response?: Response; attempt: number }): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const duration = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(duration) && duration >= 0) return duration;
  }
  return Math.min(500 * 2 ** attempt, 10_000) * (0.5 + Math.random() * 0.5);
}

function resolveServer({ options, servers }: { options: ApiOptions; servers: string[] }): URL {
  const index = options.serverIndex ?? 0;
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid server index');
  const selected = options.serverUrl ?? servers[index];
  if (!selected) throw new Error('Missing API server');
  const url = new URL(selected);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid API server');
  }
  return url;
}

async function formatResponse({
  response,
  apiKey,
}: {
  response: Response;
  apiKey: string;
}): Promise<CallToolResult> {
  // Upstream errors can echo credentials or private request data. Do not expose their bodies.
  if (!response.ok) {
    await response.body?.cancel();
    return errorResult(`API request failed (HTTP ${response.status}).`);
  }
  const mimeType = response.headers.get('content-type') ?? '';
  if (mimeType.startsWith('image/') || mimeType.startsWith('audio/')) {
    const data = Buffer.from(await response.arrayBuffer()).toString('base64');
    return {
      content: [{ type: mimeType.startsWith('image/') ? 'image' : 'audio', data, mimeType }],
    };
  }
  const text = (await response.text()).replaceAll(apiKey, '[REDACTED]');
  return { content: [{ type: 'text', text }] };
}

/** Owns the whole deadline, including retries, backoff, and response consumption. */
export async function executeRequest({
  tool,
  input,
  options,
  servers,
  signal,
}: {
  tool: CompiledTool;
  input: unknown;
  options: ApiOptions;
  servers: string[];
  signal?: AbortSignal;
}): Promise<CallToolResult> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000)
    return errorResult('Invalid API deadline.');
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    if (!options.apiKey.trim()) return errorResult('Missing API credentials.');
    const request = serializeRequest({ plan: tool.plan, input, path: tool.path });
    const server = resolveServer({ options, servers });
    // Concatenate before URL parsing so an encoded path value cannot change the origin.
    const url = new URL(`${server.href.replace(/\/$/, '')}${request.path}`);
    url.search = request.query.toString();
    request.headers.set('X-API-Key', options.apiKey);
    const retries = options.safeReadRetries ?? 0;
    if (!Number.isInteger(retries) || retries < 0 || retries > 3)
      return errorResult('Invalid safe-read retry limit.');
    const retryable = ['get', 'head'].includes(tool.method) && retries > 0;
    for (let attempt = 0; ; attempt++) {
      combined.throwIfAborted();
      let response: Response | undefined;
      try {
        response = await (options.fetch ?? fetch)(url, {
          method: tool.method.toUpperCase(),
          headers: request.headers,
          ...(request.body !== undefined ? { body: request.body } : {}),
          signal: combined,
          redirect: 'manual',
        });
      } catch {
        if (!retryable || attempt >= retries || combined.aborted)
          throw new Error('API connection failed');
      }
      const retryStatus = response && [429, 500, 502, 503, 504].includes(response.status);
      if (response && (!retryStatus || !retryable || attempt >= retries)) {
        return await formatResponse({ response, apiKey: options.apiKey });
      }
      const waitMs = retryDelay({ ...(response ? { response } : {}), attempt });
      await response?.body?.cancel();
      // Never let a huge Retry-After overflow Node's timer and retry immediately.
      // The total-deadline signal aborts this capped wait before an early retry.
      await delay(Math.min(waitMs, timeoutMs), undefined, { signal: combined });
    }
  } catch {
    if (signal?.aborted) return errorResult('API request cancelled.');
    if (controller.signal.aborted) return errorResult('API request exceeded its deadline.');
    return errorResult('API request failed. Check the input and API configuration.');
  } finally {
    clearTimeout(timer);
  }
}
