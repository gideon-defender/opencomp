import { getOidcCallbackDiagnostics } from './gideon-oidc-diagnostics';

const expectedIssuer = 'https://api.dev.gideondefender.com';

describe('OIDC callback diagnostics', () => {
  it('reports a nested issuer mismatch without logging sensitive causes', () => {
    const diagnostics = getOidcCallbackDiagnostics({
      callbackPath:
        '/callback?code=SECRET_CODE&state=SECRET_STATE&iss=https%3A%2F%2Ftenant.example.com',
      expectedIssuer,
      error: {
        message: 'invalid response encountered',
        cause: {
          message: 'unexpected "iss" (issuer) response parameter value',
          cause: { parameters: 'SECRET_CODE', access_token: 'SECRET_TOKEN' },
        },
      },
    });
    expect(diagnostics).toEqual({
      event: 'gideon_oidc_callback_failed',
      issuerOrigin: 'https://tenant.example.com',
      expectedIssuerOrigin: expectedIssuer,
      issuerCount: 1,
      issuerMatchesExpected: false,
      reasons: [
        'invalid response encountered',
        'unexpected "iss" (issuer) response parameter value',
      ],
    });
    expect(JSON.stringify(diagnostics)).not.toContain('SECRET');
  });

  it('recognizes matching and missing issuers', () => {
    for (const issuer of [expectedIssuer, null]) {
      const diagnostics = getOidcCallbackDiagnostics({
        callbackPath: issuer ? `/callback?iss=${issuer}` : '/callback',
        expectedIssuer,
        error: new Error('response parameter "iss" (issuer) missing'),
      });
      expect(diagnostics.issuerCount).toBe(issuer ? 1 : 0);
      expect(diagnostics.issuerMatchesExpected).toBe(issuer !== null);
    }
  });

  it.each([
    'https://tenant.example.com/SECRET_PATH?token=SECRET_TOKEN#SECRET_FRAGMENT',
    'https://SECRET_USER:SECRET_PASSWORD@tenant.example.com',
    'javascript:SECRET_TOKEN',
    'not-a-url',
  ])(
    'does not disclose issuer credentials, path, query or fragment: %s',
    (iss) => {
      const result = getOidcCallbackDiagnostics({
        callbackPath: `/callback?iss=${encodeURIComponent(iss)}`,
        expectedIssuer,
        error: new Error('SECRET_TOKEN in an untrusted error message'),
      });
      expect(JSON.stringify(result)).not.toContain('SECRET');
      expect(result.reasons).toEqual(['unclassified_error']);
    },
  );

  it('detects duplicate issuers and safely handles cyclic error causes', () => {
    const error: { message: string; cause?: unknown } = {
      message: 'invalid response encountered',
    };
    error.cause = error;
    expect(
      getOidcCallbackDiagnostics({
        callbackPath: `/callback?iss=${expectedIssuer}&iss=${expectedIssuer}`,
        expectedIssuer,
        error,
      }).issuerCount,
    ).toBe(2);
  });
});
