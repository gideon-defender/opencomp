// Only static, reviewed messages may reach logs. Never serialize error causes:
// openid-client includes callback parameters, tokens and claims in them.
const SAFE_REASONS = new Set([
  'invalid response encountered',
  'response parameter "iss" (issuer) missing',
  'unexpected "iss" (issuer) response parameter value',
  'response parameter "state" missing',
  'unexpected "state" response parameter value',
  'unexpected "state" response parameter encountered',
  '"iss" parameter must be provided only once',
  '"state" parameter must be provided only once',
  '"code" parameter must be provided only once',
  'unexpected JWT "iss" (issuer) claim value',
  'unexpected JWT "aud" (audience) claim value',
  'unexpected ID Token "nonce" claim value',
  'unexpected JWT claim value encountered',
  'JWT timestamp claim value failed validation',
  'unexpected HTTP response status code',
  'unexpected response content-type',
  'parsing error occured',
  'Missing login state',
  'Invalid or expired login state',
  'Incomplete token response from Gideon',
  'Gideon account has no email address',
  'Gideon email address is not verified',
]);

function issuerOrigin(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getOidcCallbackDiagnostics({
  callbackPath,
  expectedIssuer,
  error,
}: {
  callbackPath: string;
  expectedIssuer: string | undefined;
  error: unknown;
}) {
  let issuer: string | null = null;
  let issuerCount = 0;
  try {
    const params = new URL(callbackPath, 'https://callback.invalid')
      .searchParams;
    issuer = params.get('iss');
    issuerCount = params.getAll('iss').length;
  } catch {
    // Malformed callback URLs must not break the failure redirect.
  }

  const reasons: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== 'object') break;
    if ('message' in current && typeof current.message === 'string') {
      if (SAFE_REASONS.has(current.message)) reasons.push(current.message);
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return {
    event: 'gideon_oidc_callback_failed',
    issuerOrigin: issuerOrigin(issuer),
    expectedIssuerOrigin: issuerOrigin(expectedIssuer),
    issuerCount,
    issuerMatchesExpected: issuer !== null && issuer === expectedIssuer,
    reasons: reasons.length ? reasons : ['unclassified_error'],
  };
}
