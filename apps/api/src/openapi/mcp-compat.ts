import { z } from 'zod';
import type { OpenApiOperation } from './types';

const extensionSchema = z
  .object({
    name: z.string().min(1).optional(),
    disabled: z.boolean().optional(),
    description: z.string().min(1).optional(),
  })
  .passthrough();

// Temporary adapter for the generated SDK and Gram. Author only x-comp-mcp.
function readExtension(operation: OpenApiOperation) {
  const owned =
    operation['x-comp-mcp'] === undefined
      ? undefined
      : extensionSchema.parse(operation['x-comp-mcp']);
  const legacy =
    operation['x-speakeasy-mcp'] === undefined
      ? undefined
      : extensionSchema.parse(operation['x-speakeasy-mcp']);
  for (const key of ['name', 'disabled', 'description'] as const) {
    if (
      owned?.[key] !== undefined &&
      legacy?.[key] !== undefined &&
      owned[key] !== legacy[key]
    ) {
      throw new Error(`Conflicting MCP ${key}: ${operation.operationId}`);
    }
  }
  return owned || legacy ? { ...legacy, ...owned } : undefined;
}

function writeExtension({
  operation,
  extension,
}: {
  operation: OpenApiOperation;
  extension: z.infer<typeof extensionSchema>;
}) {
  operation['x-comp-mcp'] = { ...extension };
  operation['x-speakeasy-mcp'] = { ...extension };
}

function kebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

// Kept at API export while Gram needs auto-names; the owned loader also names
// unnamed operations. Compatibility tests lock both to the Phase 0 mapping.
export function applyMcpCompatibility(
  paths: Record<string, Record<string, OpenApiOperation>>,
): void {
  const used = new Set<string>();
  const operations = Object.values(paths).flatMap((methods) =>
    Object.entries(methods)
      .filter(([method]) =>
        [
          'get',
          'put',
          'post',
          'delete',
          'options',
          'head',
          'patch',
          'trace',
        ].includes(method),
      )
      .map(([, operation]) => operation),
  );
  for (const operation of operations) {
    const extension = readExtension(operation);
    if (!extension) continue;
    if (extension.name) {
      if (used.has(extension.name))
        throw new Error(`Duplicate MCP name: ${extension.name}`);
      used.add(extension.name); // Includes disabled operations: never reuse their names.
    }
    writeExtension({ operation, extension });
  }
  for (const operation of operations) {
    const extension = readExtension(operation);
    if (extension?.name || extension?.disabled || !operation.operationId)
      continue;
    const id = operation.operationId.replace(/_v\d+$/i, '');
    const separator = id.indexOf('_');
    const resource =
      separator < 0 ? '' : id.slice(0, separator).replace(/Controller$/i, '');
    const method = separator < 0 ? id : id.slice(separator + 1);
    let candidate = kebab(method);
    if (!candidate || used.has(candidate))
      candidate = kebab(`${resource}-${method}`);
    let name = candidate;
    let suffix = 2;
    while (used.has(name)) name = `${candidate}-${suffix++}`;
    if (!name)
      throw new Error(`Cannot derive MCP name: ${operation.operationId}`);
    used.add(name);
    writeExtension({ operation, extension: { ...extension, name } });
  }
}
