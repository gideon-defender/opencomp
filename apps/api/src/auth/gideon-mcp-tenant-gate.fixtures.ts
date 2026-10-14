import { HybridSessionAuth } from './hybrid-session-auth';
import { resolveGideonTenantClaim } from './gideon-tenant-claim';
import type { AuthenticatedRequest } from './types';

/**
 * Phase 0 tenant gate (Gram auth cutover) for Gideon MCP tokens.
 *
 * Every rejection below must fail closed with NO legacy `getMcpSession`
 * fallback: only genuinely non-Gideon bearers may use the legacy path.
 */
export const mockVerify = jest.fn();
export const mockIsGideonToken = jest.fn();
export const mockGetMcpSession = jest.fn();
export const mockUser = jest.fn();
export const mockMemberFirst = jest.fn();
export const mockMembersMany = jest.fn();
export const mockBinding = jest.fn();
export const mockOrg = jest.fn();
export const mockHasAppAccess = jest.fn();

export const mockIsMisconfigured = jest.fn();
export const mockIsConfigured = jest.fn();
export const mockIsEnforceMode = jest.fn();

export function gideonAuth() {
  const service = {
    isConfigured: () => mockIsConfigured(),
    isEnforceMode: () => mockIsEnforceMode(),
    verify: (...args: unknown[]) => mockVerify(...args),
    isGideonToken: (...args: unknown[]) => mockIsGideonToken(...args),
    isMisconfigured: () => mockIsMisconfigured(),
    resolveTenantClaim: (payload: Record<string, unknown>) =>
      resolveGideonTenantClaim(payload),
    resolveUserId: (payload: { sub?: string }) =>
      typeof payload.sub === 'string' && payload.sub ? payload.sub : null,
  } as unknown as import('./gideon-jwt.service').GideonJwtService;
  return new HybridSessionAuth({ gideonJwtService: service });
}

export function bearer(token = 'header.payload.sig'): AuthenticatedRequest {
  return {
    headers: { authorization: `Bearer ${token}` },
  } as unknown as AuthenticatedRequest;
}

/** Default linked setup: sub_1 → usr_1 owned by org_1, active admin member. */
export function validMocks() {
  mockVerify.mockResolvedValue({
    payload: { sub: 'sub_1', tid: 'org_1', aal: 2 },
    protectedHeader: { kid: 'k1' },
  });
  mockUser.mockImplementation(
    ({ where }: { where: Record<string, string> }) => {
      // Route by query shape (gideonSub-link lookup vs id lookup) instead of
      // call order — Once sequencing is order-fragile across tests.
      if (where.gideonSub)
        return Promise.resolve({ id: 'usr_1', tenantId: 'org_1' });
      if (where.id)
        return Promise.resolve({ id: 'usr_1', email: 'a@acme.com' });
      return Promise.resolve(null);
    },
  );
  mockOrg.mockResolvedValue({ id: 'org_1' });
  mockMemberFirst.mockResolvedValue({
    id: 'mem_1',
    role: 'admin',
    department: 'it',
  });
  mockBinding.mockResolvedValue(null);
  mockHasAppAccess.mockResolvedValue(true);
}

export function resetGateMocks() {
  // clearAllMocks is the auth-dir norm; the defaults below replace any
  // implementation a previous test set.
  jest.clearAllMocks();
  mockIsGideonToken.mockReturnValue(false);
  mockIsMisconfigured.mockReturnValue(false);
  mockIsConfigured.mockReturnValue(true);
  mockIsEnforceMode.mockReturnValue(false);
  mockGetMcpSession.mockResolvedValue(null);
  mockMembersMany.mockResolvedValue([]);
  mockHasAppAccess.mockResolvedValue(true);
  mockBinding.mockResolvedValue(null);
  mockOrg.mockResolvedValue(null);
  mockMemberFirst.mockResolvedValue(null);
  mockUser.mockResolvedValue(null);
  mockVerify.mockResolvedValue(null);
}
