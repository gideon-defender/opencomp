import type { RequestHandler } from 'express';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

const mcpClaims = z.object({
  azp: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
});

function hasMcpAudience({
  token,
  clientId,
  resource,
  tenantId,
  organizations,
}: {
  token: string;
  clientId: string | undefined;
  resource: string;
  tenantId: string;
  organizations: unknown;
}): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const claims = mcpClaims.parse(
      JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')),
    );
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return (
      claims.azp === clientId &&
      audiences.includes(clientId) &&
      audiences.includes(resource) &&
      Array.isArray(organizations) &&
      organizations.some((org) => z.object({ id: z.string() }).safeParse(org).data?.id === tenantId)
    );
  } catch {
    return false;
  }
}

/** Reuse the API's authentication and resolved tenant on every request. */
export function hostedAuth({
  apiUrl,
  publicUrl,
  oidcClientId,
  oidcIssuer,
  sharedAudience,
  fetchApi = fetch,
}: {
  apiUrl: string;
  publicUrl: string;
  oidcClientId?: string;
  oidcIssuer?: string;
  sharedAudience?: string;
  fetchApi?: typeof fetch;
}): RequestHandler {
  const origin = new URL(publicUrl);
  const resource = new URL('/mcp', origin).toString();
  const metadataUrl = new URL('/.well-known/oauth-protected-resource', origin).toString();
  const bearerChallenge = (error?: string) =>
    `Bearer resource_metadata="${metadataUrl}"${error ? `, error="${error}"` : ''}`;
  const challenge = oidcClientId && oidcIssuer ? bearerChallenge() : 'ApiKey realm="OpenComp MCP"';
  const handleAuth: RequestHandler = async (req, res, next) => {
    if (
      req.headers.host !== origin.host ||
      (req.headers.origin && req.headers.origin !== origin.origin)
    ) {
      res.sendStatus(403);
      return;
    }
    const key = req.get('apikey');
    const authorization = req.get('authorization');
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
    if ((key && authorization) || (authorization && !bearer)) {
      res.set('WWW-Authenticate', challenge).sendStatus(401);
      return;
    }
    if ((!key && !bearer) || (key && key.length > 4096) || (bearer && bearer.length > 16_384)) {
      res
        .set('WWW-Authenticate', bearer ? bearerChallenge('invalid_token') : challenge)
        .sendStatus(401);
      return;
    }
    if (
      bearer &&
      (!oidcClientId || !oidcIssuer || !sharedAudience || oidcClientId === sharedAudience)
    ) {
      res.set('WWW-Authenticate', challenge).sendStatus(401);
      return;
    }
    try {
      const response = await fetchApi(new URL('/v1/auth/me', apiUrl), {
        headers: key ? { 'X-API-Key': key } : { Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
      });
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 503;
        if (status === 401) {
          res.set(
            'WWW-Authenticate',
            bearer ? bearerChallenge('invalid_token') : 'ApiKey realm="OpenComp MCP"',
          );
        }
        res.sendStatus(status);
        return;
      }
      const identity = await response.json();
      if (bearer) {
        const person = z
          .object({
            authType: z.literal('gideon'),
            user: z.object({ id: z.string() }),
            tenantId: z.string().trim().min(1),
            organizations: z.unknown(),
          })
          .safeParse(identity);
        if (
          !person.success ||
          !hasMcpAudience({
            token: bearer,
            clientId: oidcClientId,
            resource,
            tenantId: person.data.tenantId,
            organizations: person.data.organizations,
          })
        ) {
          res.set('WWW-Authenticate', bearerChallenge('invalid_token')).sendStatus(401);
          return;
        }
      } else if (!z.object({ authType: z.literal('api-key') }).safeParse(identity).success) {
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

export function hostedResourceMetadata({
  publicUrl,
  issuer,
}: {
  publicUrl: string;
  issuer: string;
}): RequestHandler {
  const origin = new URL(publicUrl);
  const issuerUrl = new URL(issuer);
  if (
    issuerUrl.protocol !== 'https:' ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.pathname !== '/' ||
    issuerUrl.search ||
    issuerUrl.hash
  )
    throw new Error('MCP OIDC issuer must be an HTTPS origin');
  const document = {
    resource: new URL('/mcp', origin).toString(),
    authorization_servers: [issuerUrl.origin],
  };
  return (req, res) => {
    if (req.headers.host !== origin.host) {
      res.sendStatus(403);
      return;
    }
    res
      .set({
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      })
      .json(document);
  };
}
