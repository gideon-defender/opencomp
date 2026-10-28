/** Shared embedding client for risk linkage and API vector search. */
import { z } from 'zod';
import { embedBedrockTexts } from './bedrock-embeddings.js';

const DEFAULT_EMBEDDINGS_BASE_URL = 'http://localhost:11434';

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ??
  (process.env.EMBEDDINGS_PROVIDER === 'bedrock' ? 'amazon.titan-embed-text-v2:0' : 'bge-m3');
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_IDENTITY = `${process.env.EMBEDDINGS_PROVIDER ?? 'ollama'}:${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}`;

const vectorsSchema = z.array(z.array(z.number().finite()).min(1));
const responseSchema = z.union([vectorsSchema, z.object({ embeddings: vectorsSchema })]);

/** Empty/whitespace inputs are omitted; returned vectors retain the remaining input order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const valid = texts.filter((text) => text.trim().length > 0);
  if (valid.length === 0) return [];

  const provider = process.env.EMBEDDINGS_PROVIDER ?? 'ollama';
  if (provider === 'bedrock') {
    return embedBedrockTexts({ texts: valid, model: EMBEDDING_MODEL });
  }
  if (provider !== 'ollama' && provider !== 'tei') {
    throw new Error(`Unsupported embeddings provider: ${provider}`);
  }

  const baseUrl = process.env.EMBEDDINGS_BASE_URL ?? DEFAULT_EMBEDDINGS_BASE_URL;
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: valid }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Embedding request to ${baseUrl} failed (${response.status})`);
  }

  const data: unknown = await response.json();
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Embedding response from ${baseUrl} is missing embeddings or contains invalid vectors`,
    );
  }
  const embeddings = Array.isArray(parsed.data) ? parsed.data : parsed.data.embeddings;
  if (embeddings.length !== valid.length) {
    throw new Error(`Embedding response from ${baseUrl} returned an unexpected vector count`);
  }
  return embeddings;
}
