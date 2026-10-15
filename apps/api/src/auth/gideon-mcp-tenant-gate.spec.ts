import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  mockVerify,
  mockGetMcpSession,
  mockUser,
  mockMemberFirst,
  mockMembersMany,
  mockBinding,
  mockOrg,
  mockHasAppAccess,
  mockIsConfigured,
  mockIsEnforceMode,
  gideonAuth,
  bearer,
  validMocks,
  resetGateMocks,
} from './gideon-mcp-tenant-gate.fixtures';

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

describe('Gideon MCP tenant isolation', () => {
  beforeEach(resetGateMocks);
  it('authenticates a valid token and pins the token tenant', async () => {
    validMocks();
    const auth = gideonAuth();
    const req = bearer();
    await expect(auth.handleSessionAuth(req)).resolves.toBe(true);
    expect(req.isOidcJwt).toBe(true);
    expect(req.isMcpOAuth).toBe(true);
    expect(req.organizationId).toBe('org_1');
    expect(req.userId).toBe('usr_1');
    expect(req.oidcAal).toBe(2);
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it.each([
    ['missing tenant', { sub: 'sub_1' }],
    ['malformed tenant', { sub: 'sub_1', tid: 42 }],
    ['empty tenant', { sub: 'sub_1', tid: '  ' }],
    ['conflicting aliases', { sub: 'sub_1', tid: 'org_a', tenant_id: 'org_b' }],
    ['missing sub', { tid: 'org_1' }],
  ])('rejects a token with %s (401, no fallback)', async (_label, payload) => {
    mockVerify.mockResolvedValue({ payload, protectedHeader: {} });
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      /tenant claim|missing subject/,
    );
    // Rejected by the claim contract before any user lookup — a regression
    // that skipped the claim check would 401 later at the unlinked-sub step
    // and this assertion would catch the bypass.
    expect(mockUser).not.toHaveBeenCalled();
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('rejects an unlinked subject (401, no fallback, never email-matched)', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'sub_unknown', tid: 'org_1' },
      protectedHeader: {},
    });
    mockUser.mockResolvedValue(null);
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockUser).toHaveBeenCalledWith({
      where: { gideonSub: 'sub_unknown' },
      select: { id: true, email: true, tenantId: true },
    });
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant subject (403, no fallback)', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'sub_1', tid: 'org_a' },
      protectedHeader: {},
    });
    mockUser.mockResolvedValue({ id: 'usr_1', tenantId: 'org_b' });
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('rejects a tenant-less linked row as unlinked (401, not cross-tenant 403)', async () => {
    // A linked row with no tenant owner must not be reported as "belongs to
    // a different organization" — 401 keeps the client retrying auth.
    mockVerify.mockResolvedValue({
      payload: { sub: 'sub_1', tid: 'org_1' },
      protectedHeader: {},
    });
    mockUser.mockResolvedValue({ id: 'usr_1', tenantId: null });
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      /not linked/,
    );
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('fails closed on JWT-shaped bearers in enforce mode while Gideon is unconfigured (401, no fallback)', async () => {
    mockIsConfigured.mockReturnValue(false);
    mockIsEnforceMode.mockReturnValue(true);
    mockVerify.mockResolvedValue(null);
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('preserves the opaque legacy fallback while Gideon is unconfigured even in enforce mode', async () => {
    mockIsConfigured.mockReturnValue(false);
    mockIsEnforceMode.mockReturnValue(true);
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

  it('isolates same-email accounts across tenants by subject', async () => {
    // Same normalized email in two tenants: two independent User rows with
    // distinct subjects. Token B must authenticate as user B in org B only.
    mockVerify.mockResolvedValue({
      payload: { sub: 'sub_b', tid: 'org_b' },
      protectedHeader: {},
    });
    mockUser.mockImplementation(
      ({ where }: { where: Record<string, string> }) => {
        if (where.gideonSub === 'sub_b')
          return Promise.resolve({ id: 'usr_b', tenantId: 'org_b' });
        if (where.id === 'usr_b')
          return Promise.resolve({ id: 'usr_b', email: 'same@acme.com' });
        return Promise.resolve(null);
      },
    );
    mockOrg.mockResolvedValue({ id: 'org_b' });
    mockMemberFirst.mockResolvedValue({
      id: 'mem_b',
      role: 'admin',
      department: 'it',
    });
    const req = bearer();
    await expect(gideonAuth().handleSessionAuth(req)).resolves.toBe(true);
    expect(req.userId).toBe('usr_b');
    expect(req.organizationId).toBe('org_b');
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown tenant org (401, no fallback)', async () => {
    validMocks();
    mockOrg.mockResolvedValue(null);
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('rejects a stale binding that disagrees with the token tenant (403)', async () => {
    validMocks();
    mockBinding.mockResolvedValue({ organizationId: 'org_stale' });
    await expect(gideonAuth().handleSessionAuth(bearer())).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('accepts a binding that agrees with the token tenant', async () => {
    validMocks();
    mockBinding.mockResolvedValue({ organizationId: 'org_1' });
    const req = bearer();
    await expect(gideonAuth().handleSessionAuth(req)).resolves.toBe(true);
    expect(req.organizationId).toBe('org_1');
  });
});
