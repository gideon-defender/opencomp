import process from 'node:process';
import { resolveApiCredential } from '../credentials.js';
import { createOwnedServer } from '../server.js';
import { compileTools } from '../tools.js';
import type { CliFlags } from './flags.js';

export type BundledContract = { source: unknown; overlay: unknown; version: string };
export function serverFactory({ contract, flags }: { contract: BundledContract; flags: CliFlags }) {
  const { servers } = compileTools(contract);
  if (!flags.serverUrl && !servers[flags.serverIndex ?? 0]) throw new Error('Invalid server index');
  const staticApiKey = flags.apiKey ?? process.env['COMPAI_APIKEY'] ?? '';
  return (headers = new Headers()) =>
    createOwnedServer({
      ...contract,
      mode: flags.mode,
      annotationFilter: flags.annotationFilter,
      ...(flags.allowedTools ? { allowedTools: flags.allowedTools } : {}),
      getOptions: () => ({
        apiKey: resolveApiCredential({
          headers,
          staticApiKey,
          disableStaticAuth: flags.disableStaticAuth,
        }),
        ...(flags.serverUrl ? { serverUrl: flags.serverUrl } : {}),
        ...(flags.serverIndex !== undefined ? { serverIndex: flags.serverIndex } : {}),
      }),
    });
}
export type ServerFactory = ReturnType<typeof serverFactory>;
