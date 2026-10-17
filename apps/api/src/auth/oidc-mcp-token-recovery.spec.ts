import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  mockVerify,
  mockIsOidcToken,
  mockGetMcpSession,
  mockUser,
  mockMemberFirst,
  mockMembersMany,
  mockBinding,
  mockOrg,
  mockHasAppAccess,
  mockIsMisconfigured,
  gideonAuth,
  bearer,
  validMocks,
  resetGateMocks,
} from './oidc-mcp-tenant-gate.fixtures';

jest.mock('./auth.server', () => ({
  auth: {
    api: { getMcpSession: (...args: unknown[]) => mockGetMcpSession(...args) },
  },
}));
jest.mock('@db', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => mockUser(...args) },
    member: {
      findFirst: (...args: unknown[]) => mockMemberFirst(...args),
      findMany: (...args: unknown[]) => mockMembersMany(...args),
    },
    mcpOrgBinding: { findUnique: (...args: unknown[]) => mockBinding(...args) },
    organization: { findUnique: (...args: unknown[]) => mockOrg(...args) },
  },
}));
jest.mock('./app-access', () => ({
  hasAppAccess: (...args: unknown[]) => mockHasAppAccess(...args),
  stripControlChars: (value: string) => value,
}));

describe('OIDC MCP token rejection and legacy recovery', () => {
  beforeEach(resetGateMocks);
  it('accepts agreeing aliases through the full gate', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'sub_1', tid: 'org_1', tenant_id: 'org_1' },
      protectedHeader: { kid: 'k1' },
    });
    mockUser.mockImplementation(
      ({ where }: { where: Record<string, string> }) => {
        if (where.oidcSub)
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
    const req = bearer();
    await expect(gideonAuth().handleSessionAuth(req)).resolves.toBe(true);
    expect(req.organizationId).toBe('org_1');
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('rejects when the user record vanishes between link and populate (401, no fallback)', async () => {
    // The link check passes, then the by-id re-fetch misses (raced delete).
    // Fail closed with an OIDC reason instead of a silent false.
    mockVerify.mockResolvedValue({
      payload: { sub: 'sub_1', tid: 'org_1' },
      protectedHeader: { kid: 'k1' },
    });
    mockUser.mockImplementation(
      ({ where }: { where: Record<string, string> }) => {
        if (where.oidcSub)
          return Promise.resolve({ id: 'usr_1', tenantId: 'org_1' });
        return Promise.resolve(null);
      },
    );
    mockOrg.mockResolvedValue({ id: 'org_1' });
    mockMemberFirst.mockResolvedValue({
      id: 'mem_1',
      role: 'admin',
      department: 'it',
    });
    const req = bearer();
    await expect(gideonAuth().handleSessionAuth(req)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(req.isOidcJwt).toBeUndefined();
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('rejects an OIDC-presenting token that fails verification (401, no fallback)', async () => {
    // Expired, wrong audience, or bad signature all collapse to verify → null
    // here; the iss check is what separates OIDC-presenting from foreign.
    mockVerify.mockResolvedValue(null);
    mockIsOidcToken.mockReturnValue(true);
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('fails closed on JWT-shaped bearers when OIDC is misconfigured (401, no fallback)', async () => {
    // Endpoint set but issuer/audience missing: no token can be identified,
    // so JWT-shaped bearers fail closed while opaque legacy tokens still work.
    mockVerify.mockResolvedValue(null);
    mockIsOidcToken.mockReturnValue(false);
    mockIsMisconfigured.mockReturnValue(true);
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('rejects a revoked membership (403) and only queries active memberships', async () => {
    validMocks();
    mockMemberFirst.mockResolvedValue(null);
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockMemberFirst).toHaveBeenCalledWith({
      where: {
        userId: 'usr_1',
        organizationId: 'org_1',
        deactivated: false,
        idpAccessRevoked: false,
      },
      select: { id: true, role: true, department: true },
    });
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('rejects a portal-only role without app access (403, no fallback)', async () => {
    validMocks();
    mockMemberFirst.mockResolvedValue({
      id: 'mem_e',
      role: 'employee',
      department: 'none',
    });
    mockHasAppAccess.mockResolvedValue(false);
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('preserves the legacy fallback for genuinely non-OIDC bearers', async () => {
    mockVerify.mockResolvedValue(null);
    mockIsOidcToken.mockReturnValue(false);
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_legacy' });
    mockUser.mockResolvedValue({ id: 'usr_legacy', email: 'l@acme.com' });
    mockMembersMany.mockResolvedValue([
      { id: 'mem_l', role: 'owner', department: 'it', organizationId: 'org_1' },
    ]);
    const req = bearer('opaque_legacy_token');
    await expect(gideonAuth().handleSessionAuth(req)).resolves.toBe(true);
    expect(req.isMcpOAuth).toBe(true);
    expect(req.isOidcJwt).toBeUndefined();
    expect(req.userId).toBe('usr_legacy');
  });

  it('preserves the opaque legacy fallback while OIDC is misconfigured', async () => {
    mockVerify.mockResolvedValue(null);
    mockIsOidcToken.mockReturnValue(false);
    mockIsMisconfigured.mockReturnValue(true);
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_legacy' });
    mockUser.mockResolvedValue({ id: 'usr_legacy', email: 'l@acme.com' });
    mockMembersMany.mockResolvedValue([
      { id: 'mem_l', role: 'owner', department: 'it', organizationId: 'org_1' },
    ]);
    const req = bearer('opaque_legacy_token');
    await expect(gideonAuth().handleSessionAuth(req)).resolves.toBe(true);
    expect(req.userId).toBe('usr_legacy');
    expect(req.isOidcJwt).toBeUndefined();
  });
});
