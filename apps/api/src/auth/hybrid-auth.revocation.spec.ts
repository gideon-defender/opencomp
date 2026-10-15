import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { revokeSsoMember } from './sso-member-sync';
import { HybridAuthGuard } from './hybrid-auth.guard';
import { ApiKeyService } from './api-key.service';
import { OidcJwtService } from './oidc-jwt.service';
import { NativeSessionService } from './native-session.service';

const mockUserFindUnique = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockMemberFindMany = jest.fn();
const mockMemberUpdateMany = jest.fn();
const mockGetMcpSession = jest.fn();
jest.mock('./auth.server', () => ({
  auth: {
    api: { getMcpSession: (...args: unknown[]) => mockGetMcpSession(...args) },
  },
}));
jest.mock('@db', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) },
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
      findMany: (...args: unknown[]) => mockMemberFindMany(...args),
      updateMany: (...args: unknown[]) => mockMemberUpdateMany(...args),
    },
    mcpOrgBinding: { findUnique: jest.fn().mockResolvedValue(null) },
    organizationRole: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));
jest.mock('@gideon-defender/auth', () => ({
  BUILT_IN_ROLE_PERMISSIONS: { admin: { app: ['read'] } },
}));

for (const mode of ['gideon', 'session', 'mcp']) {
  describe(`HybridAuthGuard ${mode} IdP revocation`, () => {
    let guard: HybridAuthGuard;
    let revoked = false;

    beforeEach(async () => {
      jest.clearAllMocks();
      revoked = false;
      const member = {
        id: 'mem_1',
        organizationId: 'org_1',
        role: 'admin',
        department: null,
      };
      const resolveMember = ({
        where,
      }: {
        where: { idpAccessRevoked?: boolean };
      }) =>
        Promise.resolve(
          revoked && where.idpAccessRevoked === false ? null : member,
        );
      mockMemberUpdateMany.mockImplementation(
        ({
          where,
          data,
        }: {
          where: { userId: string; organizationId: string };
          data: { idpAccessRevoked: boolean; role: string };
        }) => {
          if (
            where.userId === 'usr_1' &&
            where.organizationId === member.organizationId
          ) {
            revoked = data.idpAccessRevoked;
            member.role = data.role;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        },
      );
      mockMemberFindFirst.mockImplementation(resolveMember);
      mockMemberFindMany.mockImplementation(
        async (query: { where: { idpAccessRevoked?: boolean } }) => {
          const found = await resolveMember(query);
          return found ? [found] : [];
        },
      );
      mockUserFindUnique.mockResolvedValue({
        id: 'usr_1',
        email: 'ada@example.com',
        tenantId: 'org_1',
      });
      mockGetMcpSession.mockResolvedValue(
        mode === 'mcp' ? { userId: 'usr_1' } : null,
      );
      const module = await Test.createTestingModule({
        providers: [
          HybridAuthGuard,
          { provide: ApiKeyService, useValue: {} },
          { provide: Reflector, useValue: { getAllAndOverride: () => false } },
          {
            provide: OidcJwtService,
            useValue: {
              isConfigured: () => mode === 'gideon',
              isEnforceMode: () => true,
              isShadowMode: () => false,
              verify: async () => ({ payload: { sub: 'sub_1', tid: 'org_1' } }),
              resolveTenantClaim: () => ({ ok: true, tenantId: 'org_1' }),
              resolveUserId: () => 'sub_1',
              isOidcToken: () => false,
              isMisconfigured: () => false,
            },
          },
          {
            provide: NativeSessionService,
            useValue: {
              resolveFromHeaders: async () =>
                mode === 'session'
                  ? {
                      user: { id: 'usr_1', email: 'ada@example.com' },
                      session: {
                        id: 'ses_1',
                        activeOrganizationId: 'org_1',
                        deviceAgent: false,
                      },
                    }
                  : null,
            },
          },
        ],
      }).compile();
      guard = module.get(HybridAuthGuard);
    });

    function context(): ExecutionContext {
      const request = { headers: { authorization: 'Bearer existing-token' } };
      return {
        getClass: jest.fn(),
        getHandler: jest.fn(),
        getArgs: jest.fn(),
        getArgByIndex: jest.fn(),
        getType: jest.fn(),
        switchToRpc: jest.fn(),
        switchToWs: jest.fn(),
        switchToHttp: () => ({
          getRequest: jest.fn().mockReturnValue(request),
          getResponse: jest.fn(),
          getNext: jest.fn(),
        }),
      };
    }

    it('accepts a member whose IdP access remains active', async () => {
      await expect(guard.canActivate(context())).resolves.toBe(true);
    });

    it('rejects the existing token after a confirmed IdP revocation', async () => {
      await expect(guard.canActivate(context())).resolves.toBe(true);
      await revokeSsoMember({ userId: 'usr_1', organizationId: 'org_1' });
      await expect(guard.canActivate(context())).rejects.toThrow();
      expect(mockMemberUpdateMany).toHaveBeenCalledWith({
        where: { userId: 'usr_1', organizationId: 'org_1' },
        data: { role: '', roleSource: 'sso', idpAccessRevoked: true },
      });
    });

    it('preserves access in another tenant after a scoped revocation', async () => {
      await revokeSsoMember({ userId: 'usr_1', organizationId: 'other_org' });
      await expect(guard.canActivate(context())).resolves.toBe(true);
    });
  });
}
