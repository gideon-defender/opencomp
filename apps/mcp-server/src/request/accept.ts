import { objectSchema, type JsonObject } from '../openapi/metadata.js';

// The frozen generator negotiated these multi-media responses explicitly.
// Kept as operation-specific compatibility, verified by exhaustive wire parity.
const overrides: Record<string, string> = {
  'ai-chat-policy': 'application/json;q=1, text/event-stream;q=0',
  'download-mac-agent': 'application/json;q=1, application/x-apple-diskimage;q=0',
  'download-windows-agent': 'application/json;q=1, application/zip;q=0',
  'export-by-id':
    'text/csv;q=1, application/pdf;q=0.7, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;q=0',
};
export function responseAccept(operation: JsonObject): string {
  const metadata = objectSchema.parse(operation['x-comp-mcp'] ?? {});
  const name = metadata['name'];
  if (typeof name === 'string' && overrides[name]) return overrides[name];
  const responses = objectSchema.parse(operation['responses'] ?? {});
  const mediaTypes = [
    ...new Set(
      Object.values(responses).flatMap((response) =>
        Object.keys(objectSchema.parse(objectSchema.parse(response)['content'] ?? {})),
      ),
    ),
  ];
  if (mediaTypes.includes('application/json')) return 'application/json';
  return mediaTypes[0] ?? '*/*';
}
