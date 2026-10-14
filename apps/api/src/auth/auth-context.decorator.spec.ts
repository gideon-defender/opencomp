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
      request({ isGideonJwt: true, isMcpOAuth: true }),
    );
    expect(context.isGideonJwt).toBe(true);
    expect(context.isMcpOAuth).toBe(true);
    expect(context.organizationId).toBe('org_1');
  });

  it('passes the Gideon assurance level through to consumers', () => {
    const context = toAuthContext(request({ isGideonJwt: true, gideonAal: 2 }));
    expect(context.gideonAal).toBe(2);
  });

  it('leaves the flags undefined for non-Gideon callers', () => {
    const context = toAuthContext(request());
    expect(context.isGideonJwt).toBeUndefined();
    expect(context.isMcpOAuth).toBeUndefined();
    expect(context.gideonAal).toBeUndefined();
  });

  it('throws without guard-populated auth context', () => {
    expect(() =>
      toAuthContext(
        request({ organizationId: undefined, authType: undefined }),
      ),
    ).toThrow('Ensure HybridAuthGuard is applied.');
  });
});
