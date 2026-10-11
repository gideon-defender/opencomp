import { z } from 'zod';
import { loadOpenApi } from './openapi-loader.js';
import { objectSchema } from './openapi/metadata.js';
import { compileRequest } from './request/compile.js';
import { createSchemaCompiler } from './schema/compiler.js';

export function compileTools({ source, overlay }: { source: unknown; overlay: unknown }) {
  const { document, tools } = loadOpenApi({ source, overlay });
  if (!/^3\.0\.\d+$/.test(document.openapi))
    throw new Error(`Unsupported OpenAPI version ${document.openapi}`);
  const compile = createSchemaCompiler(document);
  const registry = tools.map((tool) => {
    const plan = compileRequest({
      operation: tool.operation,
      pathItem: document.paths[tool.path] ?? {},
      path: tool.path,
      location: `${tool.operationId} (${tool.method.toUpperCase()} ${tool.path})`,
      compile,
    });
    // Conversion is also a build/startup gate; never degrade unsupported types into `any`.
    const inputSchema = z.toJSONSchema(plan.input, { io: 'input', target: 'draft-2020-12' });
    const staticInputSchema = z.toJSONSchema(plan.input, { io: 'input', target: 'draft-7' });
    const readOnlyHint = ['get', 'head', 'options'].includes(tool.method);
    return {
      ...tool,
      plan,
      inputSchema,
      staticInputSchema,
      annotations: {
        title: z.string().parse(tool.operation['summary']),
        readOnlyHint,
        // POST/PATCH can erase data too; HTTP methods cannot prove additive-only behavior.
        destructiveHint: !readOnlyHint,
        idempotentHint: readOnlyHint || tool.method === 'delete',
        openWorldHint: true,
      },
    };
  });
  const servers = z
    .array(z.object({ url: z.string().url() }).passthrough())
    .parse(document['servers'] ?? []);
  // Validate all component schema references as well, including unused or response schemas.
  const components = objectSchema.parse(document['components'] ?? {});
  const schemas = objectSchema.parse(components['schemas'] ?? {});
  for (const [name, schema] of Object.entries(schemas))
    compile({ source: schema, location: `#/components/schemas/${name}` });
  return { tools: registry, servers: servers.map((server) => server.url) };
}
export type CompiledTool = ReturnType<typeof compileTools>['tools'][number];
