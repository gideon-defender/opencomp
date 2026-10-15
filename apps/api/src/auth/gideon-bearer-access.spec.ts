import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HybridAuthGuard } from './hybrid-auth.guard';
import { ApiKeyService } from './api-key.service';
import { OidcJwtService } from './oidc-jwt.service';
import type { AuthenticatedRequest } from './types';

const mockUser = jest.fn();
const mockMember = jest.fn();
const mockBinding = jest.fn();
const mockLegacy = jest.fn();
jest.mock('./auth.server', () => ({
  auth: { api: { getMcpSession: (...args: unknown[]) => mockLegacy(...args) } },
}));
jest.mock('@db', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => mockUser(...args) },
    member: { findFirst: (...args: unknown[]) => mockMember(...args) },
    organization: { findUnique: async () => ({ id: 'tenant_a' }) },
    mcpOrgBinding: { findUnique: (...args: unknown[]) => mockBinding(...args) },
    organizationRole: { findMany: async () => [] },
  },
}));

describe('Gideon bearer access through HybridAuthGuard', () => {
  let guard: HybridAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.mockResolvedValue({
      id: 'usr_a',
      email: 'a@b.com',
      tenantId: 'tenant_a',
    });
    mockMember.mockResolvedValue({
      id: 'mem_a',
      role: 'admin',
      department: null,
    });
    mockBinding.mockResolvedValue(null);
    const jwt = new OidcJwtService();
    jest.spyOn(jwt, 'isConfigured').mockReturnValue(true);
    jest.spyOn(jwt, 'verify').mockResolvedValue({
      payload: { sub: 'sub_a', tid: 'tenant_a' },
      protectedHeader: {},
    });
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    guard = new HybridAuthGuard(new ApiKeyService(), reflector, jwt);
  });

  function context(request: AuthenticatedRequest): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  function bearer(): AuthenticatedRequest {
    return {
      headers: { authorization: 'Bearer valid.gideon.token' },
    } as unknown as AuthenticatedRequest;
  }

  it('rejects a conflicting binding before accepting a valid bearer', async () => {
    mockBinding.mockResolvedValue({ organizationId: 'tenant_b' });
    const request = bearer();
    await expect(guard.canActivate(context(request))).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockBinding).toHaveBeenCalledWith({
      where: { userId: 'usr_a' },
      select: { organizationId: true },
    });
    expect(request.isOidcJwt).toBeUndefined();
    expect(mockLegacy).not.toHaveBeenCalled();
  });

  it.each(['employee', 'contractor'])(
    'rejects a %s bearer without app access',
    async (role) => {
      mockMember.mockResolvedValue({ id: 'mem_a', role, department: null });
      const request = bearer();
      await expect(guard.canActivate(context(request))).rejects.toThrow(
        ForbiddenException,
      );
      expect(request.isOidcJwt).toBeUndefined();
      expect(mockLegacy).not.toHaveBeenCalled();
    },
  );

  it.each([null, { organizationId: 'tenant_a' }])(
    'accepts admin access with binding %j',
    async (binding) => {
      mockBinding.mockResolvedValue(binding);
      const request = bearer();
      await expect(guard.canActivate(context(request))).resolves.toBe(true);
      expect(request.organizationId).toBe('tenant_a');
      expect(request.isOidcJwt).toBe(true);
      expect(mockLegacy).not.toHaveBeenCalled();
    },
  );
});
