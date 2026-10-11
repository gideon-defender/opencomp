import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send, client } = vi.hoisted(() => ({ send: vi.fn(), client: vi.fn() }));
vi.mock('@aws-sdk/client-bedrock-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-bedrock-runtime')>();
  return {
    ...actual,
    BedrockRuntimeClient: class {
      constructor(options: unknown) {
        client(options);
      }
      send = send;
      destroy() {}
    },
  };
});
const vector = Array.from({ length: 1024 }, () => 0.25);
const response = (embedding: unknown) => ({
  body: new TextEncoder().encode(JSON.stringify({ embedding })),
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('EMBEDDINGS_PROVIDER', 'bedrock');
  vi.stubEnv('EMBEDDING_MODEL', 'amazon.titan-embed-text-v2:0');
  vi.stubEnv('AWS_REGION', 'us-east-2');
  vi.stubEnv('EMBEDDINGS_BASE_URL', 'https://bedrock-runtime.us-east-2.amazonaws.com');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Bedrock embeddings', () => {
  it('uses InvokeModel with Titan input and the credential chain instead of Ollama fetch', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    send.mockResolvedValue(response(vector));
    const { embedTexts } = await import('./embedding-client');
    await expect(embedTexts(['alpha', ' ', 'beta'])).resolves.toEqual([vector, vector]);
    expect(fetch).not.toHaveBeenCalled();
    expect(client).toHaveBeenCalledWith({ region: 'us-east-2' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([command]) => JSON.parse(command.input.body))).toEqual([
      { inputText: 'alpha', dimensions: 1024, normalize: true },
      { inputText: 'beta', dimensions: 1024, normalize: true },
    ]);
    expect(send.mock.calls[0]?.[0].input.modelId).toBe('amazon.titan-embed-text-v2:0');
  });

  it('preserves input order when model requests complete out of order', async () => {
    const other = vector.map(() => 0.5);
    send.mockImplementation(async (command) => {
      const { inputText } = JSON.parse(command.input.body);
      if (inputText === 'first') await new Promise((resolve) => setTimeout(resolve, 10));
      return response(inputText === 'first' ? vector : other);
    });
    const { embedTexts } = await import('./embedding-client');
    await expect(embedTexts(['first', 'second'])).resolves.toEqual([vector, other]);
  });

  it.each([undefined, [0.1], Array(1024).fill('bad')])(
    'rejects invalid model vectors',
    async (value) => {
      send.mockResolvedValue(response(value));
      const { embedTexts } = await import('./embedding-client');
      await expect(embedTexts(['text'])).rejects.toThrow(/embedding/i);
    },
  );

  it('limits simultaneous requests for large task batches', async () => {
    let active = 0;
    let maximum = 0;
    send.mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return response(vector);
    });
    const { embedTexts } = await import('./embedding-client');
    await expect(embedTexts(Array(9).fill('text'))).resolves.toHaveLength(9);
    expect(maximum).toBe(4);
  });

  it('uses APP_AWS_REGION when AWS_REGION is absent', async () => {
    delete process.env.AWS_REGION;
    vi.stubEnv('APP_AWS_REGION', 'us-east-2');
    send.mockResolvedValue(response(vector));
    const { embedTexts } = await import('./embedding-client');
    await embedTexts(['text']);
    expect(client).toHaveBeenCalledWith({ region: 'us-east-2' });
  });

  it('propagates model invocation failures', async () => {
    send.mockRejectedValue(new Error('AccessDeniedException'));
    const { embedTexts } = await import('./embedding-client');
    await expect(embedTexts(['text'])).rejects.toThrow('AccessDeniedException');
  });

  it('does not create a client for empty input', async () => {
    const { embedTexts } = await import('./embedding-client');
    await expect(embedTexts([' '])).resolves.toEqual([]);
    expect(client).not.toHaveBeenCalled();
  });

  it('defaults to the Titan model when Bedrock is selected', async () => {
    delete process.env.EMBEDDING_MODEL;
    const { EMBEDDING_MODEL } = await import('./embedding-client');
    expect(EMBEDDING_MODEL).toBe('amazon.titan-embed-text-v2:0');
  });

  it('rejects unknown providers instead of silently using Ollama', async () => {
    vi.stubEnv('EMBEDDINGS_PROVIDER', 'typo');
    const { embedTexts } = await import('./embedding-client');
    await expect(embedTexts(['text'])).rejects.toThrow(/provider/i);
  });
});
