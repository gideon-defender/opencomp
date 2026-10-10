import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request } from 'express';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { landingPageExpress } from '../landing-page.js';
import type { ServerFactory } from './factory.js';
import type { CliFlags } from './flags.js';
import { hostedAuth } from './hosted.js';
import { adaptHttpTransport } from './transport.js';

function headersOf(request: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

export async function startHttp({
  factory,
  flags,
}: {
  factory: ServerFactory;
  flags: CliFlags;
}): Promise<void> {
  const app = express();
  if (flags.hosted && (!flags.publicUrl || !flags.serverUrl))
    throw new Error('Missing hosted configuration');
  const hostedOrigin = flags.publicUrl ? new URL(flags.publicUrl).origin : undefined;
  const active = new Set<ReturnType<ServerFactory>>();
  const sessions = new Map<
    string,
    { server: ReturnType<ServerFactory>; transport: SSEServerTransport; key: string | null }
  >();
  app.get('/', landingPageExpress);
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  if (flags.command === 'serve') {
    app.use((req, res, next) => {
      res.set({
        'Access-Control-Allow-Origin': hostedOrigin ?? '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
    if (flags.hosted) {
      if (!flags.serverUrl || !flags.publicUrl) throw new Error('Missing hosted configuration');
      app.use('/mcp', hostedAuth({ apiUrl: flags.serverUrl, publicUrl: flags.publicUrl }));
    }
    app.use(express.json());
    app.post('/mcp', async (req, res) => {
      const server = factory(headersOf(req));
      active.add(server);
      const transport = new StreamableHTTPServerTransport({});
      const cleanup = () => {
        active.delete(server);
        void server.close();
      };
      res.once('close', cleanup);
      try {
        await server.connect(adaptHttpTransport(transport));
        await transport.handleRequest(req, res, req.body);
      } catch {
        cleanup();
        if (!res.headersSent) res.status(500).send('MCP request failed.');
      }
    });
  } else {
    app.get('/sse', async (req, res) => {
      const headers = headersOf(req);
      const server = factory(headers);
      const sessionId = randomUUID();
      const transport = new SSEServerTransport(`/message/${sessionId}`, res);
      active.add(server);
      const cleanup = () => {
        sessions.delete(sessionId);
        active.delete(server);
        void server.close();
      };
      sessions.set(sessionId, { server, transport, key: headers.get('apikey') });
      res.once('close', cleanup);
      try {
        await server.connect(transport);
      } catch {
        cleanup();
        if (!res.headersSent) res.status(500).send('MCP connection failed.');
      }
    });
    const handleMessage: express.RequestHandler = async (req, res) => {
      const sessionId = req.params['sessionId'] ?? req.query['sessionId'];
      const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (!session) {
        res.status(404).send('Session not found');
        return;
      }
      // Do not allow a request to switch to another user's established SSE session.
      const key = headersOf(req).get('apikey');
      if (session.key !== key) {
        res.sendStatus(403);
        return;
      }
      try {
        await session.transport.handlePostMessage(req, res);
      } catch {
        if (!res.headersSent) res.status(400).send('Invalid MCP message.');
      }
    };
    app.post('/message', handleMessage);
    app.post('/message/:sessionId', handleMessage);
  }
  const listener = app.listen(flags.port, '0.0.0.0');
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
  });
  if (['debug', 'info'].includes(flags.logLevel)) process.stderr.write('MCP HTTP server ready.\n');
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(1), 5000);
    void Promise.all([...active].map((server) => server.close())).finally(() => {
      listener.close(() => {
        clearTimeout(timer);
        process.exit(0);
      });
      listener.closeAllConnections();
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
