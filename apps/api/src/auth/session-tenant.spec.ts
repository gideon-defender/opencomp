jest.mock('./auth.server', () => ({
  auth: { api: { getMcpSession: jest.fn().mockResolvedValue(null) } },
}));
jest.mock('./legacy-session-revocation', () => ({
  LegacySessionRevocation: class {
    rejectsSession() {
      return false;
    }
  },
}));

const mockSession = jest.fn();
const mockMember = jest.fn();
const mockPlatformFrameworks = jest.fn();
const mockCustomFrameworks = jest.fn();
jest.mock('@db', () => ({
  db: {
    session: { findUnique: (...args: unknown[]) => mockSession(...args) },
    member: { findFirst: (...args: unknown[]) => mockMember(...args) },
    frameworkEditorFramework: {
      findMany: (...args: unknown[]) => mockPlatformFrameworks(...args),
    },
    customFramework: {
      findMany: (...args: unknown[]) => mockCustomFrameworks(...args),
    },
  },
}));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { auth } from './auth.server';
import { HybridSessionAuth } from './hybrid-session-auth';
import { NativeSessionService } from './native-session.service';
import type { AuthenticatedRequest } from './types';
import { findAvailableFrameworks } from '../frameworks/available-frameworks';

const tenantId = 'org_tenant';
const sessionRow = () => ({
  id: 'ses_1',
  expiresAt: new Date(Date.now() + 60_000),
  activeOrganizationId: tenantId,
  deviceAgent: false,
  user: { id: 'usr_1', email: 'user@example.com', tenantId },
});

function request(overrides: Record<string, unknown> = {}) {
  return {
    headers: { cookie: 'local.session_token=token' },
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

describe('native session tenant binding', () => {
  const guard = new HybridSessionAuth({
    nativeSessionService: new NativeSessionService(),
  });
  let membership: {
    isActive: boolean;
    deactivated: boolean;
    idpAccessRevoked: boolean;
    role: string;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue(sessionRow());
    membership = {
      isActive: true,
      deactivated: false,
      idpAccessRevoked: false,
      role: 'admin',
    };
    mockMember.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        where.organizationId === tenantId &&
        where.isActive === membership.isActive &&
        where.deactivated === membership.deactivated &&
        where.idpAccessRevoked === membership.idpAccessRevoked
          ? { id: 'mem_1', role: membership.role, department: 'engineering' }
          : null,
    );
  });

  it.each(['admin', 'employee'])(
    'resolves the tenant and %s membership',
    async (role) => {
      membership.role = role;
      const req = request();
      await expect(guard.handleSessionAuth(req)).resolves.toBe(true);
      expect(req.organizationId).toBe(tenantId);
      expect(req.memberId).toBe('mem_1');
      expect(req.userRoles).toEqual([role]);
      expect(mockSession).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            user: { select: { id: true, email: true, tenantId: true } },
          }),
        }),
      );
    },
  );

  it('derives the tenant when the compatibility field is null', async () => {
    mockSession.mockResolvedValue({
      ...sessionRow(),
      activeOrganizationId: null,
    });
    const req = request();
    await expect(guard.handleSessionAuth(req)).resolves.toBe(true);
    expect(req.organizationId).toBe(tenantId);
  });

  it('rejects a conflicting stored organization without MCP fallback', async () => {
    mockSession.mockResolvedValue({
      ...sessionRow(),
      activeOrganizationId: 'org_other',
    });
    await expect(guard.handleSessionAuth(request())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockMember).not.toHaveBeenCalled();
    expect(auth.api.getMcpSession).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', '   '])(
    'rejects missing tenant ownership: %p',
    async (tenant) => {
      mockSession.mockResolvedValue({
        ...sessionRow(),
        user: { ...sessionRow().user, tenantId: tenant },
      });
      await expect(guard.handleSessionAuth(request())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMember).not.toHaveBeenCalled();
    },
  );

  it.each([
    { isActive: false },
    { deactivated: true },
    { idpAccessRevoked: true },
  ])('rejects inactive or revoked membership: %p', async (flags) => {
    Object.assign(membership, flags);
    await expect(guard.handleSessionAuth(request())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects missing tenant membership', async () => {
    mockMember.mockResolvedValue(null);
    await expect(guard.handleSessionAuth(request())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockMember).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      headers: {
        cookie: 'local.session_token=token',
        'x-organization-id': 'org_other',
      },
    },
    { params: { organizationId: 'org_other' } },
    { params: { orgId: 'org_other' } },
    { query: { organizationId: 'org_other' } },
    { body: { organizationId: 'org_other' } },
    { body: { orgId: 'org_other' } },
    { query: { organizationId: [tenantId, 'org_other'] } },
    { body: { organizationId: null } },
  ])(
    'rejects caller-supplied organization overrides: %p',
    async (overrides) => {
      await expect(guard.handleSessionAuth(request(overrides))).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockMember).not.toHaveBeenCalled();
      expect(auth.api.getMcpSession).not.toHaveBeenCalled();
    },
  );

  it('accepts matching organization hints without changing context', async () => {
    const req = request({
      headers: {
        cookie: 'local.session_token=token',
        'x-organization-id': tenantId,
      },
      params: { orgId: tenantId },
      query: { organizationId: tenantId },
      body: { organizationId: tenantId },
    });
    await expect(guard.handleSessionAuth(req)).resolves.toBe(true);
    expect(req.organizationId).toBe(tenantId);
  });

  it('allows tenant-bound bootstrap before membership exists', async () => {
    mockSession.mockResolvedValue({
      ...sessionRow(),
      activeOrganizationId: null,
    });
    mockMember.mockResolvedValue(null);
    const req = request();
    await expect(guard.handleSessionAuth(req, true)).resolves.toBe(true);
    expect(req.organizationId).toBe(tenantId);
    expect(mockMember).not.toHaveBeenCalled();
  });

  it('does not expose private frameworks to a tenant-bound session without membership', async () => {
    mockSession.mockResolvedValue({
      ...sessionRow(),
      activeOrganizationId: null,
    });
    mockMember.mockResolvedValue(null);
    mockPlatformFrameworks.mockResolvedValue([{ id: 'frk_public' }]);
    mockCustomFrameworks.mockResolvedValue([{ id: 'cfrm_private' }]);
    const req = request();
    await guard.handleSessionAuth(req, true);
    expect(req.organizationId).toBe(tenantId);

    const frameworks = await findAvailableFrameworks({
      organizationId: req.organizationId,
      authType: req.authType,
      userId: req.userId,
    });

    expect(frameworks).toEqual([{ id: 'frk_public', isCustom: false }]);
    expect(mockCustomFrameworks).not.toHaveBeenCalled();
  });

  it('does not allow bootstrap to bypass a requested tenant conflict', async () => {
    await expect(
      guard.handleSessionAuth(
        request({ body: { organizationId: 'org_other' } }),
        true,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
