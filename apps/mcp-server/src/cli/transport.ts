import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/** SDK 1.26 transport optional callbacks include undefined; our TS config is exact-optional. */
export function adaptHttpTransport(transport: StreamableHTTPServerTransport): Transport {
  const adapter: Transport = {
    start: () => transport.start(),
    close: () => transport.close(),
    send: (message, options) => transport.send(message, options),
  };
  transport.onclose = () => adapter.onclose?.();
  transport.onerror = (error) => adapter.onerror?.(error);
  transport.onmessage = (message, extra) => adapter.onmessage?.(message, extra);
  return adapter;
}
