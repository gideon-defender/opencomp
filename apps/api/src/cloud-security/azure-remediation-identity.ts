/**
 * Remediator service-principal token acquisition for Azure (Phase A).
 *
 * Azure has no STS-AssumeRole / `generateAccessToken` equivalent, so fixes
 * execute by authenticating AS the class SP directly (OAuth2
 * client-credentials flow) per execution. These primitives back the
 * binding-time trust probe (`azure-remediation-trust.validator`) and,
 * in A4, the execute path. Secrets are never logged and never leave the
 * vault except inside the token-request body.
 */

export interface AzureSpToken {
  accessToken: string;
  /** Lifetime in seconds as reported by Entra. */
  expiresIn: number;
}

export type AzureFetch = typeof fetch;

interface EntraTokenResponse {
  access_token?: string;
  expires_in?: number | string;
}

function errorBody(status: number, body: string, scope: string): Error {
  // The body can echo the client secret back in some Entra error shapes —
  // never include it. Status + truncated body is enough to diagnose.
  const snippet = body.slice(0, 200);
  return new Error(
    `Azure SP token request failed (${status}) for ${scope}: ${snippet}`,
  );
}

/**
 * Mint an access token as a remediator SP (client-credentials flow,
 * management-plane audience). Throws on any failure — callers treat a
 * throw as "trust unproven, refuse visibly", never as proof of safety.
 */
export async function mintAzureSpToken(params: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetchFn?: AzureFetch;
}): Promise<AzureSpToken> {
  const fetchFn = params.fetchFn ?? fetch;
  const tokenUrl = `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/token`;
  let response: Response;
  try {
    response = await fetchFn(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        scope: 'https://management.azure.com/.default',
        grant_type: 'client_credentials',
      }).toString(),
    });
  } catch (err) {
    throw new Error(
      `Azure SP token request unreachable for tenant ${params.tenantId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    throw errorBody(
      response.status,
      await response.text(),
      `tenant ${params.tenantId}`,
    );
  }
  const data = (await response.json()) as EntraTokenResponse;
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error(
      `Azure SP token response carried no access token for tenant ${params.tenantId}`,
    );
  }
  const expiresIn =
    typeof data.expires_in === 'string'
      ? Number.parseInt(data.expires_in, 10)
      : (data.expires_in ?? 3600);
  return {
    accessToken: data.access_token,
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600,
  };
}

/**
 * Effective ARM actions for the token holder at subscription scope
 * (`Microsoft.Authorization/permissions`). Used by the trust probe to
 * prove a bound SP holds no wildcard or never-allow grant. Throws on
 * non-OK responses EXCEPT 401/403 — a least-privilege SP is not expected
 * to read authorization state, so denial is inconclusive (documented at
 * the validator), while any other failure is a hard error.
 */
export async function readAzureEffectiveActions(params: {
  accessToken: string;
  subscriptionId: string;
  fetchFn?: AzureFetch;
}): Promise<{ actions: string[] } | { denied: true }> {
  const fetchFn = params.fetchFn ?? fetch;
  const url =
    `https://management.azure.com/subscriptions/${params.subscriptionId}` +
    `/providers/Microsoft.Authorization/permissions?api-version=2022-04-01`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
  } catch (err) {
    throw new Error(
      `Azure permissions read unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    return { denied: true };
  }
  if (!response.ok) {
    throw new Error(
      `Azure permissions read failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }
  const data = (await response.json()) as {
    value?: Array<{ actions?: string[] }>;
  };
  const actions = (data.value ?? []).flatMap((entry) =>
    Array.isArray(entry.actions) ? entry.actions : [],
  );
  return { actions };
}

/**
 * Decode the unsigned claims of a JWT the backend just minted via Entra
 * over TLS. Signature verification is unnecessary here: the token came
 * straight from the token endpoint, so the claims only answer "which SP
 * and tenant did Entra mint this for" — binding the probe to the right
 * identity. Returns null when the token is not a decodable JWT.
 */
export function decodeAzureTokenClaims(
  accessToken: string,
): { appid?: string; tid?: string } | null {
  const parts = accessToken.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const claims = JSON.parse(payload) as Record<string, unknown>;
    if (typeof claims !== 'object' || claims === null) return null;
    const out: { appid?: string; tid?: string } = {};
    if (typeof claims.appid === 'string') out.appid = claims.appid;
    if (typeof claims.tid === 'string') out.tid = claims.tid;
    return out;
  } catch {
    return null;
  }
}
