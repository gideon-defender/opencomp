import { z } from 'zod';
import {
  assignToolNames,
  metadataSchema,
  objectSchema,
  operationEntries,
  readMetadata,
} from './openapi/metadata.js';
import { applyOwnedOverlay, overlaySchema } from './openapi/overlay.js';

const documentSchema = z
  .object({
    openapi: z.string().startsWith('3.'),
    paths: z.record(z.string(), objectSchema),
  })
  .passthrough();

// Phase 1: own metadata/overlay registry only. Schema compilation and HTTP
// execution are Phase 2; this does not replace the generated server yet.
export function loadOpenApi({ source, overlay }: { source: unknown; overlay: unknown }) {
  const document = documentSchema.parse(structuredClone(source));
  const entries = operationEntries(document.paths);
  assignToolNames(entries);
  applyOwnedOverlay({ document, entries, overlay: overlaySchema.parse(overlay) });
  // Validate explicit overlay name changes against all names, including disabled.
  const names = new Set<string>();
  for (const { operation } of entries) {
    const metadata = metadataSchema.parse(operation['x-comp-mcp']);
    if (!metadata.name) continue;
    if (names.has(metadata.name)) throw new Error(`Duplicate MCP name: ${metadata.name}`);
    names.add(metadata.name);
  }
  const tools = entries.flatMap(({ path, method, operation }) => {
    const metadata = readMetadata(operation);
    if (metadata.disabled) return [];
    const name = z.string().min(1).parse(metadata.name);
    const operationId = z.string().min(1).parse(operation['operationId']);
    const summary = z.string().min(1).parse(operation['summary']);
    const description = z.string().min(1).parse(operation['description']);
    return [
      {
        name,
        description: metadata.description ?? `${summary}\n\n${description}`,
        method,
        path,
        operationId,
        operation,
      },
    ];
  });
  return { document, tools };
}
