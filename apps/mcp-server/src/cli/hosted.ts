import type { RequestHandler } from 'express';
import { z } from 'zod';

/** Reuse the API's key validation, expiry and organization binding on every request. */
export function hostedAuth({
  apiUrl,
  publicUrl,
  fetchApi = fetch,
}: {
  apiUrl: string;
  publicUrl: string;
  fetchApi?: typeof fetch;
}): RequestHandler {
  const origin = new URL(publicUrl);
  const handleAuth: RequestHandler = async (req, res, next) => {
    if (
      req.headers.host !== origin.host ||
      (req.headers.origin && req.headers.origin !== origin.origin)
    ) {
      res.sendStatus(403);
      return;
    }
    const key = req.get('apikey');
    if (!key?.trim() || key.length > 4096) {
      res.set('WWW-Authenticate', 'ApiKey realm="OpenComp MCP"').sendStatus(401);
      return;
    }
    try {
      const response = await fetchApi(new URL('/v1/auth/me', apiUrl), {
        headers: { 'X-API-Key': key },
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
      });
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 503;
        if (status === 401) res.set('WWW-Authenticate', 'ApiKey realm="OpenComp MCP"');
        res.sendStatus(status);
        return;
      }
      const identity = z
        .object({ authType: z.literal('api-key') })
        .safeParse(await response.json());
      if (!identity.success) {
        res.sendStatus(503);
        return;
      }
      next();
    } catch {
      res.sendStatus(503);
    }
  };
  return handleAuth;
}
