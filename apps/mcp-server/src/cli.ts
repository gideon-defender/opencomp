import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import process from 'node:process';
import { serverFactory, type BundledContract } from './cli/factory.js';
import { help, parseCli } from './cli/flags.js';
import { startHttp } from './cli/http.js';

// Replaced by the owned build with the local spec/overlay, not a live fetch.
declare const __OPENCOMP_CONTRACT__: BundledContract;

async function main(): Promise<void> {
  const flags = parseCli(process.argv.slice(2));
  if (flags.version) {
    process.stdout.write(`${__OPENCOMP_CONTRACT__.version}\n`);
    return;
  }
  if (flags.help) {
    process.stdout.write(help);
    return;
  }
  for (const { key, value } of flags.env) process.env[key] = value;
  const factory = serverFactory({ contract: __OPENCOMP_CONTRACT__, flags });
  if (flags.command === 'serve' || flags.transport === 'sse') {
    await startHttp({ factory, flags });
    return;
  }
  const server = factory();
  await server.connect(new StdioServerTransport());
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void server.close().then(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
void main().catch(() => {
  // Parser errors may contain credential flag values. Keep stderr sanitized.
  process.stderr.write('MCP startup failed. Check command flags and configuration.\n');
  process.exitCode = 1;
});
