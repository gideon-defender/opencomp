import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ExecutionContext } from '../server.js';
import type { CompiledTool } from '../tools.js';

export function registerDiscovery({
  server,
  tools,
  execute,
}: {
  server: McpServer;
  tools: CompiledTool[];
  execute: (input: {
    name: string;
    input: unknown;
    context: ExecutionContext;
  }) => Promise<CallToolResult>;
}): void {
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    'list_tools',
    {
      description:
        'List available tools. Optionally filter by search terms that match against tool name, description, and scopes.',
      inputSchema: { search_terms: z.array(z.string()).optional() },
      annotations,
    },
    ({ search_terms }) => {
      const terms = (search_terms ?? []).map((term) => term.toLowerCase());
      const matches = tools.filter(
        (tool) =>
          !terms.length ||
          terms.some(
            (term) =>
              tool.name.toLowerCase().includes(term) ||
              tool.description.toLowerCase().includes(term),
          ),
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              matches.map(({ name, description }) => ({ name, description })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );
  server.registerTool(
    'describe_tool_input',
    {
      description:
        'Get the input schema for one or more tools. It is a good idea to call this tool first to understand how to successfully call execute_tool.',
      inputSchema: { tool_names: z.array(z.string()) },
      annotations,
    },
    ({ tool_names }) => {
      if (!tool_names.length)
        return { content: [{ type: 'text', text: 'No tool names provided.' }] };
      const parts: string[] = [];
      const unknown: string[] = [];
      for (const name of tool_names) {
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool) {
          unknown.push(name);
          continue;
        }
        const schema =
          !tool.plan.body && !tool.plan.parameters.length
            ? 'This tool takes no input parameters.'
            : JSON.stringify(tool.inputSchema, null, 2);
        parts.push(`<input_schema tool="${name}">\n\n${schema}\n\n</input_schema>`);
      }
      if (unknown.length) parts.push(`Unknown tools: ${unknown.join(', ')}`);
      return { content: [{ type: 'text', text: parts.join('\n\n') }] };
    },
  );
  server.registerTool(
    'execute_tool',
    {
      description:
        'Execute a tool by name with its arguments. If executing a given tool for the first time, it is recommended to call describe_tool_input first to understand the expected `arguments` shape.',
      inputSchema: { name: z.string(), arguments: z.looseObject({}).optional() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args, context) => execute({ name: args.name, input: args.arguments ?? {}, context }),
  );
  // The current scope inventory is empty; like the legacy runtime, do not expose list_scopes.
}
