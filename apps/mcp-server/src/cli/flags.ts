import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { AnnotationFilter } from '../server.js';

const names = ['readOnly', 'destructive', 'idempotent', 'openWorld'] as const;
const levels = ['debug', 'warning', 'info', 'error'] as const;
export function parseCli(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      transport: { type: 'string', default: 'stdio' },
      port: { type: 'string', default: '2718' },
      tool: { type: 'string', multiple: true },
      mode: { type: 'string' },
      'tool-annotations': { type: 'string' },
      apikey: { type: 'string' },
      'server-url': { type: 'string' },
      'server-index': { type: 'string' },
      'log-level': { type: 'string', default: 'info' },
      env: { type: 'string', multiple: true },
      'disable-static-auth': { type: 'boolean', default: false },
      hosted: { type: 'boolean', default: false },
      'public-url': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (positionals.length > 1) throw new Error('Expected one command');
  const command = z.enum(['start', 'serve']).parse(positionals[0] ?? 'start');
  const hosted = values.hosted === true;
  const publicUrl =
    values['public-url'] === undefined ? undefined : z.url().parse(values['public-url']);
  if (hosted) {
    if (
      command !== 'serve' ||
      !values['server-url'] ||
      !publicUrl ||
      values.apikey ||
      envHasKey(values.env)
    )
      throw new Error(
        'Hosted mode requires serve and explicit API/public URLs, without static credentials',
      );
    for (const value of [values['server-url'], publicUrl]) {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        throw new Error('Hosted URLs must be HTTPS origins');
    }
  }
  const annotationFilter: AnnotationFilter = {};
  if (values['tool-annotations'] !== undefined) {
    const selected = values['tool-annotations']
      .split(',')
      .map((value) => z.enum(names).parse(value.trim()));
    for (const name of names) annotationFilter[`${name}Hint`] = selected.includes(name);
  }
  const env = (values.env ?? []).map((value) => {
    const separator = value.indexOf('=');
    if (separator < 1 || separator === value.length - 1)
      throw new Error('Expected non-empty NAME=VALUE');
    return { key: value.slice(0, separator), value: value.slice(separator + 1) };
  });
  return {
    command,
    help: values.help === true || args.length === 0,
    version: values.version === true,
    transport: z.enum(['stdio', 'sse']).parse(values.transport),
    port: z.coerce.number().int().min(0).max(65535).parse(values.port),
    mode: values.mode === undefined ? ('static' as const) : z.literal('dynamic').parse(values.mode),
    logLevel: z.enum(levels).parse(values['log-level']),
    annotationFilter,
    env,
    allowedTools: values.tool ? new Set(values.tool) : undefined,
    apiKey: values.apikey,
    serverUrl: values['server-url'] === undefined ? undefined : z.url().parse(values['server-url']),
    serverIndex:
      values['server-index'] === undefined
        ? undefined
        : z.coerce.number().int().nonnegative().parse(values['server-index']),
    disableStaticAuth: hosted || values['disable-static-auth'] === true,
    hosted,
    publicUrl,
  };
}
export type CliFlags = ReturnType<typeof parseCli>;
function envHasKey(values: string[] | undefined): boolean {
  return values?.some((value) => value.startsWith('COMPAI_APIKEY=')) ?? false;
}
export const help = `OpenComp MCP: mcp <start|serve> [options]
start: --transport stdio|sse (default stdio); serve: Streamable HTTP at /mcp
--port 2718 --apikey KEY --server-url URL --server-index INDEX
--tool NAME (repeatable) --mode dynamic
--tool-annotations readOnly,destructive,idempotent,openWorld
  Listed annotations must be true; unlisted must be false.
--log-level debug|warning|info|error --env NAME=VALUE (repeatable)
--disable-static-auth (serve) --help --version
--hosted --public-url HTTPS_ORIGIN (serve; requires --server-url HTTPS_ORIGIN)
Credentials: --apikey, then COMPAI_APIKEY; HTTP apikey header overrides both.
`;
