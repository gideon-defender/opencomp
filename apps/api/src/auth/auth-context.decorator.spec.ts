import { toAuthContext } from './auth-context.decorator';
import type { AuthenticatedRequest } from './types';

function request(overrides: Partial<AuthenticatedRequest> = {}) {
  return {
    organizationId: 'org_1',
    authType: 'session',
    isApiKey: false,
    userRoles: ['admin'],
    ...overrides,
  } as AuthenticatedRequest;
}

describe('toAuthContext', () => {
  it('passes Gideon and MCP flags through to consumers', () => {
    const context = toAuthContext(
      request({ isOidcJwt: true, isMcpOAuth: true }),
    );
    expect(context.isOidcJwt).toBe(true);
    expect(context.isMcpOAuth).toBe(true);
    expect(context.organizationId).toBe('org_1');
  });

  it('passes the Gideon assurance level through to consumers', () => {
    const context = toAuthContext(request({ isOidcJwt: true, oidcAal: 2 }));
    expect(context.oidcAal).toBe(2);
  });

  it('leaves the flags undefined for non-Gideon callers', () => {
    const context = toAuthContext(request());
    expect(context.isOidcJwt).toBeUndefined();
    expect(context.isMcpOAuth).toBeUndefined();
    expect(context.oidcAal).toBeUndefined();
  });

  it('throws without guard-populated auth context', () => {
    expect(() =>
      toAuthContext(
        request({ organizationId: undefined, authType: undefined }),
      ),
    ).toThrow('Ensure HybridAuthGuard is applied.');
  });
});
