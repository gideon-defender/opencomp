import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { errorResult, executeRequest, type ApiOptions } from './client.js';
import { registerDiscovery } from './server/discovery.js';
import { compileTools } from './tools.js';

export type ExecutionContext = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type AnnotationFilter = Partial<
  Record<'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint', boolean>
>;

/** Core wiring only: the generated CLI/transports remain the serving entry points until parity cutover. */
export function createOwnedServer({
  source,
  overlay,
  mode = 'static',
  allowedTools,
  annotationFilter = {},
  getOptions,
}: {
  source: unknown;
  overlay: unknown;
  mode?: 'static' | 'dynamic';
  allowedTools?: ReadonlySet<string>;
  annotationFilter?: AnnotationFilter;
  /** Resolve credentials for each call, never a shared hosted-user credential. */
  getOptions: (context: ExecutionContext) => ApiOptions | Promise<ApiOptions>;
}) {
  const registry = compileTools({ source, overlay });
  const tools = registry.tools.filter(
    (tool) =>
      (!allowedTools || allowedTools.has(tool.name)) &&
      Object.entries(annotationFilter).every(
        ([key, value]) => Reflect.get(tool.annotations, key) === value,
      ),
  );
  const server = new McpServer({ name: 'OpenComp', version: '0.3.0' });
  const execute = async ({
    name,
    input,
    context,
  }: {
    name: string;
    input: unknown;
    context: ExecutionContext;
  }) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) return errorResult(`Unknown tool: ${name}`);
    const parsed = tool.plan.input.safeParse(input);
    if (!parsed.success) return errorResult(`Invalid input for tool ${name}.`);
    try {
      return await executeRequest({
        tool,
        input: parsed.data,
        options: await getOptions(context),
        servers: registry.servers,
        signal: context.signal,
      });
    } catch {
      return errorResult('API credential configuration failed.');
    }
  };
  if (mode === 'dynamic') registerDiscovery({ server, tools, execute });
  else
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.plan.input,
          annotations: tool.annotations,
        },
        (input: unknown, context: ExecutionContext) => execute({ name: tool.name, input, context }),
      );
    }
  return server;
}
