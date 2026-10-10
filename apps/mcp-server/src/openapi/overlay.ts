import { z } from 'zod';
import { metadataSchema, objectSchema, type JsonObject, type OperationEntry } from './metadata.js';

export const overlaySchema = z
  .object({
    version: z.literal(1),
    schemas: z.array(
      z
        .object({
          name: z.string().min(1),
          removeProperties: z.array(z.string().min(1)).default([]),
          properties: z
            .record(z.string(), z.object({ description: z.string().min(1) }).strict())
            .default({}),
        })
        .strict(),
    ),
    operations: z.array(
      z
        .object({
          path: z.string().startsWith('/'),
          method: z.enum(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']),
          metadata: metadataSchema,
        })
        .strict(),
    ),
  })
  .strict();

export function applyOwnedOverlay({
  document,
  entries,
  overlay,
}: {
  document: JsonObject;
  entries: OperationEntry[];
  overlay: z.infer<typeof overlaySchema>;
}): void {
  const components = objectSchema.parse(document['components']);
  const schemas = objectSchema.parse(components['schemas']);
  components['schemas'] = schemas;
  document['components'] = components;
  for (const update of overlay.schemas) {
    const schema = objectSchema.parse(schemas[update.name]);
    const properties = objectSchema.parse(schema['properties']);
    for (const name of update.removeProperties) {
      if (!(name in properties))
        throw new Error(`Missing overlay property: ${update.name}.${name}`);
      delete properties[name];
      if (schema['required'] !== undefined) {
        schema['required'] = z
          .array(z.string())
          .parse(schema['required'])
          .filter((key) => key !== name);
      }
    }
    for (const [name, metadata] of Object.entries(update.properties)) {
      if (!(name in properties))
        throw new Error(`Missing overlay property: ${update.name}.${name}`);
      properties[name] = { ...objectSchema.parse(properties[name]), ...metadata };
    }
    schema['properties'] = properties;
    schemas[update.name] = schema;
  }
  const updated = new Set<string>();
  for (const update of overlay.operations) {
    const key = `${update.method} ${update.path}`;
    if (updated.has(key)) throw new Error(`Duplicate overlay operation: ${key}`);
    updated.add(key);
    const entry = entries.find(
      ({ path, method }) => path === update.path && method === update.method,
    );
    if (!entry) throw new Error(`Missing overlay operation: ${key}`);
    // Owned overlay intentionally overrides the base metadata. No source mutation.
    const existing = metadataSchema.parse(entry.operation['x-comp-mcp'] ?? {});
    entry.operation['x-comp-mcp'] = { ...existing, ...update.metadata };
    delete entry.operation['x-speakeasy-mcp'];
  }
}
