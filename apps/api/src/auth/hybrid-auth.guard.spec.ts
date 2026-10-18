import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HybridAuthGuard } from './hybrid-auth.guard';
import { ApiKeyService } from './api-key.service';
import { SKIP_ORG_CHECK_KEY } from './skip-org-check.decorator';
import { resolveOidcTenantClaim } from './oidc-tenant-claim';

// Mock auth.server — only the legacy MCP session resolver the guard still
// uses as fallback for Gram-issued OAuth tokens.
const mockGetMcpSession = jest.fn();
jest.mock('./auth.server', () => ({
  auth: {
    api: {
      getMcpSession: (...args: unknown[]) => mockGetMcpSession(...args),
    },
  },
}));

// Mock @db — the guard resolves the user, then enumerates active memberships
// (device-agent style) to bind the organization for the MCP OAuth path.
const mockUserFindUnique = jest.fn();
const mockMemberFindMany = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockOrgFindUnique = jest.fn();
const mockMcpBindingFindUnique = jest.fn();
const mockOrgRoleFindMany = jest.fn();
jest.mock('@db', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    member: {
      findMany: (...args: unknown[]) => mockMemberFindMany(...args),
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
    },
    organization: {
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
    mcpOrgBinding: {
      findUnique: (...args: unknown[]) => mockMcpBindingFindUnique(...args),
    },
    organizationRole: {
      findMany: (...args: unknown[]) => mockOrgRoleFindMany(...args),
    },
  },
}));

// Service-token validation is a pure lookup; mock it so tests can present a
// valid token and reach the x-user-id acting-member resolution.
const mockResolveServiceByToken = jest.fn();
jest.mock('./service-token.config', () => ({
  resolveServiceByToken: (...args: unknown[]) =>
    mockResolveServiceByToken(...args),
}));

// Mock @gideon-defender/auth — the app-access gate reads BUILT_IN_ROLE_PERMISSIONS to
// decide which roles grant app access. owner/admin/auditor do; employee does not.
jest.mock('@gideon-defender/auth', () => ({
  BUILT_IN_ROLE_PERMISSIONS: {
    owner: { app: ['read'] },
    admin: { app: ['read'] },
    auditor: { app: ['read'] },
    employee: { policy: ['read'], portal: ['read', 'update'] },
    contractor: { policy: ['read'], portal: ['read', 'update'] },
  },
}));

describe('HybridAuthGuard — MCP OAuth path', () => {
  let guard: HybridAuthGuard;
  let reflector: Reflector;

  // A real object so the guard's mutations (userId, userRoles, …) are observable.
  const createContext = (
    headers: Record<string, string>,
  ): { context: ExecutionContext; request: Record<string, unknown> } => {
    const request: Record<string, unknown> = { headers };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridAuthGuard,
        {
          provide: ApiKeyService,
          useValue: { extractApiKey: jest.fn(), validateApiKey: jest.fn() },
        },
        Reflector,
      ],
    }).compile();

    guard = module.get<HybridAuthGuard>(HybridAuthGuard);
    reflector = module.get<Reflector>(Reflector);
    // Not public, and don't skip the org check.
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    // No org binding by default; individual tests override.
    mockMcpBindingFindUnique.mockResolvedValue(null);
    // No custom roles by default (built-in roles resolve without a DB call).
    mockOrgRoleFindMany.mockResolvedValue([]);
  });

  it('authenticates a single-org user (admin) and binds org + roles', async () => {
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_1', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'admin@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_1',
        role: 'owner,admin',
        department: 'it',
        organizationId: 'org_1',
      },
    ]);

    const { context, request } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.userId).toBe('usr_1');
    expect(request.organizationId).toBe('org_1');
    expect(request.userRoles).toEqual(['owner', 'admin']);
    expect(request.authType).toBe('session');
    expect(request.isApiKey).toBe(false);
    expect(request.memberId).toBe('mem_1');
  });

  it('authenticates a read-only member and surfaces their role for RBAC', async () => {
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_2', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_2',
      email: 'auditor@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_2',
        role: 'auditor',
        department: 'none',
        organizationId: 'org_1',
      },
    ]);

    const { context, request } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.userRoles).toEqual(['auditor']);
    expect(request.organizationId).toBe('org_1');
  });

  it('rejects when the bearer token is not a valid MCP OAuth token', async () => {
    mockGetMcpSession.mockResolvedValue(null);

    const { context } = createContext({
      authorization: 'Bearer not_a_token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a valid token whose user has no organization', async () => {
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_3', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_3',
      email: 'orphan@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([]);

    const { context } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    // 403 (authenticated, but no org) — not a 401 that would trigger re-auth.
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks an org-less user even on org-agnostic (skipOrgCheck) endpoints', async () => {
    // skipOrgCheck = true for this request, but the user belongs to no org —
    // a "foreign" user must not be able to use the MCP at all.
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) => key === SKIP_ORG_CHECK_KEY);
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_x', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_x',
      email: 'stranger@example.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([]); // member of nothing

    const { context } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('multi-org with no saved choice → asks them to pick (no silent tenant)', async () => {
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_5', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_5',
      email: 'consultant@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_a',
        role: 'admin',
        department: 'none',
        organizationId: 'org_a',
      },
      {
        id: 'mem_b',
        role: 'owner',
        department: 'none',
        organizationId: 'org_b',
      },
    ]);
    mockMcpBindingFindUnique.mockResolvedValue(null);

    const { context, request } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    // 403 (token is valid — user just needs to pick an org), not a 401.
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    // No tenant must have been bound.
    expect(request.organizationId).toBe('');
  });

  it('multi-org with a saved choice → binds the chosen org', async () => {
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_6', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_6',
      email: 'consultant@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_a',
        role: 'admin',
        department: 'none',
        organizationId: 'org_a',
      },
      { id: 'mem_b', role: 'owner', department: 'it', organizationId: 'org_b' },
    ]);
    mockMcpBindingFindUnique.mockResolvedValue({ organizationId: 'org_b' });

    const { context, request } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.organizationId).toBe('org_b');
    expect(request.memberId).toBe('mem_b');
    expect(request.userRoles).toEqual(['owner']);
  });

  it('multi-org with a stale choice (no longer a member) → asks them to pick', async () => {
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_7', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_7',
      email: 'consultant@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_a',
        role: 'admin',
        department: 'none',
        organizationId: 'org_a',
      },
      {
        id: 'mem_b',
        role: 'owner',
        department: 'none',
        organizationId: 'org_b',
      },
    ]);
    // Bound to an org they were removed from.
    mockMcpBindingFindUnique.mockResolvedValue({ organizationId: 'org_gone' });

    const { context } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    // 403 (token is valid — user just needs to pick an org), not a 401.
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks a Portal-only role (employee) — no app access, no MCP', async () => {
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_e', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_e',
      email: 'employee@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_e',
        role: 'employee',
        department: 'none',
        organizationId: 'org_1',
      },
    ]);

    const { context, request } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(request.organizationId).toBe('');
  });

  it('blocks a legacy staff user on a Portal-only membership — no bypass remains', async () => {
    // Regression: platform-admin bypass was removed. A user whose legacy
    // `User.role` was 'admin' but whose membership grants no app access
    // must still be rejected from the MCP path. The `role: 'admin'` field
    // is load-bearing: without it this test cannot tell a legacy admin
    // from an ordinary user and would pass even with the bypass restored.
    mockGetMcpSession.mockResolvedValue({
      userId: 'usr_staff',
      scopes: 'openid',
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_staff',
      email: 'staff@gideondefender.com',
      role: 'admin',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_staff',
        role: 'employee',
        department: 'none',
        organizationId: 'org_1',
      },
    ]);

    const { context } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows a custom role that grants app access', async () => {
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_c', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_c',
      email: 'custom@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_c',
        role: 'Compliance Lead',
        department: 'none',
        organizationId: 'org_1',
      },
    ]);
    // Custom role resolved from organization_role with app access granted.
    mockOrgRoleFindMany.mockResolvedValue([
      { permissions: JSON.stringify({ app: ['read'], control: ['read'] }) },
    ]);

    const { context, request } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.organizationId).toBe('org_1');
    expect(request.userRoles).toEqual(['Compliance Lead']);
  });

  it('blocks a custom role that lacks app access', async () => {
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_d', scopes: 'openid' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_d',
      email: 'limited@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_d',
        role: 'Read Only Portal',
        department: 'none',
        organizationId: 'org_1',
      },
    ]);
    mockOrgRoleFindMany.mockResolvedValue([
      { permissions: JSON.stringify({ policy: ['read'], portal: ['read'] }) },
    ]);

    const { context } = createContext({
      authorization: 'Bearer mcp_access_token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('HybridAuthGuard — OIDC JWT enforcement', () => {
  let guard: HybridAuthGuard;
  let reflector: Reflector;
  let enforce = false;
  let misconfigured = false;
  let configured = true;
  const mockVerify = jest.fn();
  const mockIsOidcToken = jest.fn();
  const mockLogMismatch = jest.fn();
  const mockNativeResolve = jest.fn();

  const createContext = (
    headers: Record<string, string>,
  ): { context: ExecutionContext; request: Record<string, unknown> } => {
    const request: Record<string, unknown> = { headers };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    enforce = false;
    misconfigured = false;
    configured = true;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridAuthGuard,
        {
          provide: ApiKeyService,
          useValue: { extractApiKey: jest.fn(), validateApiKey: jest.fn() },
        },
        Reflector,
      ],
    }).compile();

    reflector = module.get<Reflector>(Reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const apiKeyService = module.get<ApiKeyService>(ApiKeyService);
    // The OIDC services are @Optional() constructor deps — inject stubs
    // directly so the Bearer path is exercised without JWKS network access.
    const oidcJwtService = {
      isConfigured: () => configured,
      isEnforceMode: () => enforce,
      isShadowMode: () => !enforce,
      verify: (...args: unknown[]) => mockVerify(...args),
      isOidcToken: (...args: unknown[]) => mockIsOidcToken(...args),
      isMisconfigured: () => misconfigured,
      // Delegate to the real strict resolver so guard tests pin the same
      // contract the gate enforces (missing/malformed/conflict).
      resolveTenantClaim: (payload: Record<string, unknown>) =>
        resolveOidcTenantClaim(payload),
      resolveUserId: (payload: { sub?: string }) =>
        typeof payload.sub === 'string' && payload.sub ? payload.sub : null,
    } as unknown as import('./oidc-jwt.service').OidcJwtService;
    const gideonShadowService = {
      logTenantOperationsMismatch: (...args: unknown[]) =>
        mockLogMismatch(...args),
    } as unknown as import('../gideon/gideon-shadow.service').GideonShadowService;
    const nativeSessionService = {
      resolveFromHeaders: (...args: unknown[]) => mockNativeResolve(...args),
    } as unknown as import('./native-session.service').NativeSessionService;
    guard = new HybridAuthGuard(
      apiKeyService,
      reflector,
      oidcJwtService,
      gideonShadowService,
      nativeSessionService,
    );
    mockLogMismatch.mockResolvedValue(undefined);
    // No native/MCP session by default; individual tests opt in.
    // Tokens present as non-OIDC by default; enforce-failure tests opt in.
    mockIsOidcToken.mockReturnValue(false);
    mockNativeResolve.mockResolvedValue(null);
    mockGetMcpSession.mockResolvedValue(null);
    mockMcpBindingFindUnique.mockResolvedValue(null);
    mockOrgRoleFindMany.mockResolvedValue([]);
  });

  function mockLinkedUser() {
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-1', tid: 'org_1', email: 'gin@acme.com' },
      protectedHeader: { kid: 'k1' },
    });
    // oidcSub → OpenComp user link (provisioned at OIDC first login).
    // the linked row's immutable tenantId must equal the token tenant.
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
      tenantId: 'org_1',
    });
    mockOrgFindUnique.mockResolvedValue({ id: 'org_1' });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_1',
      role: 'admin',
      department: 'it',
    });
  }

  it('authenticates a linked OIDC sub and binds org + member', async () => {
    mockLinkedUser();

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // The OIDC `sub` must be resolved through User.oidcSub — never used
    // directly as the OpenComp user id.
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { oidcSub: 'gideon-sub-1' },
      select: { id: true, email: true, tenantId: true },
    });
    expect(request.authType).toBe('gideon');
    expect(request.isOidcJwt).toBe(true);
    expect(request.organizationId).toBe('org_1');
    expect(request.userId).toBe('usr_1');
    expect(request.userEmail).toBe('gin@acme.com');
    expect(request.userRoles).toEqual(['admin']);
    expect(request.memberId).toBe('mem_1');
  });

  it('shadow mode: invalid OIDC token falls through to a valid session', async () => {
    mockVerify.mockResolvedValue(null);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_9',
      role: 'owner',
      department: 'none',
    });

    const { context, request } = createContext({
      authorization: 'Bearer stale.gideon.token',
      cookie: 'local.session_token=legacy',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('session');
    expect(request.userId).toBe('usr_9');
    expect(request.isOidcJwt).toBeUndefined();
  });

  it('shadow mode: unlinked sub falls through to session (dual-run fallback)', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-unknown', tid: 'org_1' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue(null);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_9',
      role: 'owner',
      department: 'none',
    });

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
      cookie: 'local.session_token=legacy',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('session');
    expect(request.userId).toBe('usr_9');
  });

  it.each([
    ['missing tenant', { sub: 'gideon-sub-1' }],
    ['malformed tenant', { sub: 'gideon-sub-1', tid: 42 }],
    ['conflicting aliases', { sub: 'gideon-sub-1', tid: 'a', tenant_id: 'b' }],
    ['missing sub', { tid: 'org_1' }],
  ])(
    'shadow mode: token with %s falls through to session',
    async (_label, payload) => {
      mockVerify.mockResolvedValue({
        payload,
        protectedHeader: { kid: 'k1' },
      });
      mockNativeResolve.mockResolvedValue({
        user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
        session: {
          id: 'sess_9',
          activeOrganizationId: 'org_9',
          deviceAgent: false,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      mockMemberFindFirst.mockResolvedValue({
        id: 'mem_9',
        role: 'owner',
        department: 'none',
      });

      const { context, request } = createContext({
        authorization: 'Bearer gideon.jwt.token',
        cookie: 'local.session_token=legacy',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.authType).toBe('session');
      expect(request.userId).toBe('usr_9');
      expect(request.isOidcJwt).toBeUndefined();
    },
  );

  it('shadow mode: cross-tenant subject falls through to session', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-1', tid: 'org_a' },
      protectedHeader: { kid: 'k1' },
    });
    // Linked row is owned by another tenant — the direct path rejects, but
    // shadow still honors the ambient session.
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
      tenantId: 'org_b',
    });
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_9',
      role: 'owner',
      department: 'none',
    });

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
      cookie: 'local.session_token=legacy',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('session');
    expect(request.userId).toBe('usr_9');
    expect(request.isOidcJwt).toBeUndefined();
  });

  it('shadow mode: non-member of token org falls through to session', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-1', tid: 'org_1' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
      tenantId: 'org_1',
    });
    mockOrgFindUnique.mockResolvedValue({ id: 'org_1' });
    // No membership in the token org for the direct path, but the ambient
    // org membership still resolves for the session fallback.
    mockMemberFindFirst.mockImplementation(
      ({ where }: { where: Record<string, string> }) =>
        where.organizationId === 'org_1'
          ? null
          : { id: 'mem_9', role: 'owner', department: 'none' },
    );
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
      cookie: 'local.session_token=legacy',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('session');
    expect(request.userId).toBe('usr_9');
    expect(request.isOidcJwt).toBeUndefined();
  });

  it('enforce mode: invalid OIDC token is a 401 with no session fallback', async () => {
    enforce = true;
    mockVerify.mockResolvedValue(null);
    // Forged token presents as an OIDC JWT (JWT-shaped, matching iss) but
    // fails verification → hard 401.
    mockIsOidcToken.mockReturnValue(true);

    const { context } = createContext({
      authorization: 'Bearer forged.jwt.token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Gideon JWT',
    );
    expect(mockNativeResolve).not.toHaveBeenCalled();
  });

  it('enforce mode: opaque session bearer falls through to session (dual-run)', async () => {
    enforce = true;
    mockVerify.mockResolvedValue(null);
    mockIsOidcToken.mockReturnValue(false);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: true,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_9',
      role: 'owner',
      department: 'none',
    });

    const { context, request } = createContext({
      authorization: 'Bearer opaque-device-agent-session-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('session');
    expect(request.userId).toBe('usr_9');
    expect(request.isOidcJwt).toBeUndefined();
  });

  it('enforce mode: foreign-issuer JWT falls through to session', async () => {
    enforce = true;
    mockVerify.mockResolvedValue(null);
    mockIsOidcToken.mockReturnValue(false);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_9',
      role: 'owner',
      department: 'none',
    });

    const { context, request } = createContext({
      authorization: 'Bearer foreign.issuer.jwt',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('session');
    expect(request.userId).toBe('usr_9');
  });

  it('enforce mode: unlinked sub is a 401 (no memberships possible)', async () => {
    enforce = true;
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-unknown', tid: 'org_1' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue(null);

    const { context } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Gideon JWT',
    );
    expect(mockNativeResolve).not.toHaveBeenCalled();
  });

  it('enforce mode: linked user still authenticates', async () => {
    enforce = true;
    mockLinkedUser();

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('gideon');
    expect(request.userId).toBe('usr_1');
  });

  it('resolves the organization by tid-as-id (tenant is the org)', async () => {
    mockLinkedUser();

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockOrgFindUnique).toHaveBeenCalledWith({
      where: { id: 'org_1' },
      select: { id: true },
    });
    expect(request.organizationId).toBe('org_1');
  });

  it('scopes membership + request to the tenant org id (tid == org id)', async () => {
    mockVerify.mockResolvedValue({
      payload: {
        sub: 'gideon-sub-1',
        tid: 'tenant-abc',
        email: 'gin@acme.com',
      },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
      tenantId: 'tenant-abc',
    });
    mockOrgFindUnique.mockResolvedValue({ id: 'tenant-abc' });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_1',
      role: 'admin',
      department: 'it',
    });

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockOrgFindUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-abc' },
      select: { id: true },
    });
    // Membership and request scoping use the tenant org id directly.
    expect(mockMemberFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'usr_1',
        organizationId: 'tenant-abc',
        deactivated: false,
        idpAccessRevoked: false,
      },
      select: { id: true, role: true, department: true },
    });
    expect(request.organizationId).toBe('tenant-abc');
  });

  it.each([
    ['missing tenant', { sub: 'gideon-sub-1' }],
    ['malformed tenant', { sub: 'gideon-sub-1', tid: 42 }],
    ['conflicting aliases', { sub: 'gideon-sub-1', tid: 'a', tenant_id: 'b' }],
    ['missing sub', { tid: 'org_1' }],
  ])('enforce mode: token with %s is a 401', async (_label, payload) => {
    enforce = true;
    mockVerify.mockResolvedValue({
      payload,
      protectedHeader: { kid: 'k1' },
    });

    const { context } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Gideon JWT',
    );
    expect(mockNativeResolve).not.toHaveBeenCalled();
  });

  it('enforce mode: cross-tenant subject is a 401', async () => {
    enforce = true;
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-1', tid: 'org_a' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
      tenantId: 'org_b',
    });

    const { context } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Gideon JWT',
    );
    expect(mockNativeResolve).not.toHaveBeenCalled();
  });

  it('enforce mode: non-member of token org is a 401', async () => {
    enforce = true;
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-1', tid: 'org_1' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
      tenantId: 'org_1',
    });
    mockOrgFindUnique.mockResolvedValue({ id: 'org_1' });
    // Linked and org-known, but no active membership in the token org.
    mockMemberFindFirst.mockResolvedValue(null);

    const { context } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Gideon JWT',
    );
    expect(mockNativeResolve).not.toHaveBeenCalled();
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('enforce mode: JWT-shaped bearer fails closed while OIDC is misconfigured', async () => {
    // Endpoint set but issuer/audience missing: tokens cannot be identified,
    // so JWT-shaped bearers fail closed instead of falling back to session.
    enforce = true;
    misconfigured = true;
    mockVerify.mockResolvedValue(null);
    mockIsOidcToken.mockReturnValue(false);

    const { context } = createContext({
      authorization: 'Bearer opaque.jwt.token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Gideon JWT',
    );
    expect(mockNativeResolve).not.toHaveBeenCalled();
  });

  it('enforce mode: opaque bearer still falls through while OIDC is misconfigured', async () => {
    misconfigured = true;
    enforce = true;
    mockVerify.mockResolvedValue(null);
    mockIsOidcToken.mockReturnValue(false);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_9',
      role: 'owner',
      department: 'none',
    });

    const { context, request } = createContext({
      authorization: 'Bearer opaque-device-agent-session-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('session');
  });

  it('enforce mode: JWT-shaped bearer fails closed while OIDC is unconfigured', async () => {
    // GIDEON_JWT_ENABLED without an identity URL: no legitimate OIDC token
    // can exist, so a JWT-shaped bearer must not silently fall back.
    enforce = true;
    configured = false;
    mockVerify.mockResolvedValue(null);

    const { context } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Gideon JWT',
    );
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockNativeResolve).not.toHaveBeenCalled();
  });

  it('enforce mode: opaque bearer still falls through while OIDC is unconfigured', async () => {
    // Native session bearers are opaque — only JWT-shaped bearers fail
    // closed above.
    enforce = true;
    configured = false;
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_9',
      role: 'owner',
      department: 'none',
    });

    const { context, request } = createContext({
      authorization: 'Bearer opaque-device-agent-session-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('session');
    expect(request.isOidcJwt).toBeUndefined();
  });

  it('falls back to the linked user email when the verified email claim is not a string', async () => {
    // Verified payloads are attacker-shaped JSON: a non-string email must
    // not be stamped onto the request.
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-1', tid: 'org_1', email: 42 },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
      tenantId: 'org_1',
    });
    mockOrgFindUnique.mockResolvedValue({ id: 'org_1' });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_1',
      role: 'admin',
      department: 'it',
    });

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.userEmail).toBe('gin@acme.com');
  });

  it('enforce mode: tenant with no mapped organization is a 401', async () => {
    enforce = true;
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-1', tid: 'tenant-unknown' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
      tenantId: 'tenant-unknown',
    });
    mockOrgFindUnique.mockResolvedValue(null);

    const { context } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid Gideon JWT',
    );
    expect(mockNativeResolve).not.toHaveBeenCalled();
  });

  it('shadow mode: tenant with no mapped organization falls through to session', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-1', tid: 'tenant-unknown' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
      tenantId: 'tenant-unknown',
    });
    mockOrgFindUnique.mockResolvedValue(null);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_9',
      role: 'owner',
      department: 'none',
    });

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
      cookie: 'local.session_token=legacy',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authType).toBe('session');
    expect(request.userId).toBe('usr_9');
  });

  it('no Bearer header skips OIDC entirely and uses the session', async () => {
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', tenantId: 'org_9' },
      session: {
        id: 'sess_9',
        activeOrganizationId: 'org_9',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_9',
      role: 'owner',
      department: 'none',
    });

    const { context, request } = createContext({
      cookie: 'local.session_token=legacy',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(request.authType).toBe('session');
  });
});

describe('HybridAuthGuard — service token x-user-id acting member', () => {
  let guard: HybridAuthGuard;
  let reflector: Reflector;

  const createContext = (
    headers: Record<string, string>,
  ): { context: ExecutionContext; request: Record<string, unknown> } => {
    const request: Record<string, unknown> = { headers };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const svcHeaders = (userId?: string): Record<string, string> => ({
    'x-service-token': 'valid_service_token',
    'x-organization-id': 'org_1',
    ...(userId ? { 'x-user-id': userId } : {}),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridAuthGuard,
        {
          provide: ApiKeyService,
          useValue: { extractApiKey: jest.fn(), validateApiKey: jest.fn() },
        },
        Reflector,
      ],
    }).compile();
    guard = module.get<HybridAuthGuard>(HybridAuthGuard);
    reflector = module.get<Reflector>(Reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    // Valid service token + existing org so we reach the x-user-id block.
    mockResolveServiceByToken.mockReturnValue({
      definition: { name: 'Local trigger' },
    });
    mockOrgFindUnique.mockResolvedValue({ id: 'org_1' });
    mockMemberFindFirst.mockResolvedValue(null);
  });

  it('attributes an ACTIVE member: sets request.userId + memberId, scoped to active memberships', async () => {
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_active',
      userId: 'usr_active',
    });

    const { context, request } = createContext(svcHeaders('usr_active'));
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.userId).toBe('usr_active');
    expect(request.memberId).toBe('mem_active');
    // The lookup must exclude deactivated/inactive memberships.
    expect(mockMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'usr_active',
          organizationId: 'org_1',
          deactivated: false,
          idpAccessRevoked: false,
          isActive: true,
        }),
      }),
    );
  });

  it('does NOT attribute a deactivated/inactive member (no userId/memberId set)', async () => {
    // The active-only filter yields no row for an offboarded member.
    mockMemberFindFirst.mockResolvedValue(null);

    const { context, request } = createContext(svcHeaders('usr_offboarded'));
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.userId).toBeUndefined();
    expect(request.memberId).toBeUndefined();
    // Auth still succeeds as a service token, just with no acting user.
    expect(request.isServiceToken).toBe(true);
  });
});

describe('HybridAuthGuard — native session first (Milestone 3)', () => {
  let guard: HybridAuthGuard;
  let reflector: Reflector;
  const mockResolveFromHeaders = jest.fn();

  const createContext = (
    headers: Record<string, string>,
  ): { context: ExecutionContext; request: Record<string, unknown> } => {
    const request: Record<string, unknown> = { headers };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridAuthGuard,
        {
          provide: ApiKeyService,
          useValue: { extractApiKey: jest.fn(), validateApiKey: jest.fn() },
        },
        Reflector,
      ],
    }).compile();

    reflector = module.get<Reflector>(Reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const apiKeyService = module.get<ApiKeyService>(ApiKeyService);
    const nativeSessionService = {
      resolveFromHeaders: (...args: unknown[]) =>
        mockResolveFromHeaders(...args),
    } as unknown as import('./native-session.service').NativeSessionService;
    guard = new HybridAuthGuard(
      apiKeyService,
      reflector,
      undefined,
      undefined,
      nativeSessionService,
    );
    // Native miss by default; individual tests opt into a hit.
    mockResolveFromHeaders.mockResolvedValue(null);
    mockGetMcpSession.mockResolvedValue(null);
    mockMemberFindFirst.mockResolvedValue(null);
  });

  function mockNativeHit() {
    mockResolveFromHeaders.mockResolvedValue({
      user: { id: 'usr_1', email: 'native@acme.com', tenantId: 'org_1' },
      session: {
        id: 'ses_native',
        activeOrganizationId: 'org_1',
        deviceAgent: false,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_1',
      role: 'admin',
      department: 'it',
    });
  }

  it('resolves the session natively without touching better-auth', async () => {
    mockNativeHit();

    const { context, request } = createContext({
      cookie: 'local.session_token=native_tok',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockResolveFromHeaders).toHaveBeenCalledWith({
      cookieHeader: 'local.session_token=native_tok',
      authHeader: undefined,
    });
    expect(mockGetMcpSession).not.toHaveBeenCalled();
    expect(request.authType).toBe('session');
    expect(request.userId).toBe('usr_1');
    expect(request.userEmail).toBe('native@acme.com');
    expect(request.userRoles).toEqual(['admin']);
    expect(request.memberId).toBe('mem_1');
    expect(request.sessionId).toBe('ses_native');
  });

  it('native miss with no MCP token is a 401 (no better-auth fallback)', async () => {
    mockResolveFromHeaders.mockResolvedValue(null);
    mockGetMcpSession.mockResolvedValue(null);

    const { context } = createContext({
      cookie: 'local.session_token=stale',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockGetMcpSession).toHaveBeenCalledTimes(1);
  });
});

describe('HybridAuthGuard — MCP vian OIDC JWT', () => {
  let guard: HybridAuthGuard;
  let reflector: Reflector;
  const mockVerify = jest.fn();

  const createContext = (
    headers: Record<string, string>,
  ): { context: ExecutionContext; request: Record<string, unknown> } => {
    const request: Record<string, unknown> = { headers };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridAuthGuard,
        {
          provide: ApiKeyService,
          useValue: { extractApiKey: jest.fn(), validateApiKey: jest.fn() },
        },
        Reflector,
      ],
    }).compile();

    reflector = module.get<Reflector>(Reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const apiKeyService = module.get<ApiKeyService>(ApiKeyService);
    const oidcJwtService = {
      isConfigured: () => true,
      isEnforceMode: () => false,
      isShadowMode: () => true,
      verify: (...args: unknown[]) => mockVerify(...args),
      // Non-OIDC by default so verify-failures fall through to legacy;
      // OIDC-failure tests opt into `true` to assert fail-closed.
      isOidcToken: () => false,
      isMisconfigured: () => false,
      // Delegate to the real strict resolver (see enforce describe).
      resolveTenantClaim: (payload: Record<string, unknown>) =>
        resolveOidcTenantClaim(payload),
      resolveUserId: (payload: { sub?: string }) =>
        typeof payload.sub === 'string' && payload.sub ? payload.sub : null,
    } as unknown as import('./oidc-jwt.service').OidcJwtService;
    guard = new HybridAuthGuard(
      apiKeyService,
      reflector,
      oidcJwtService,
      undefined,
      undefined,
    );
    mockGetMcpSession.mockResolvedValue(null);
    mockMcpBindingFindUnique.mockResolvedValue(null);
    mockOrgRoleFindMany.mockResolvedValue([]);
  });

  it('consumes an OIDC bearer on the direct path (tenant-pinned, no legacy MCP lookup)', async () => {
    // Precedence: HybridAuthGuard tries the direct OIDC-JWT path before
    // the MCP branch, so a fully-linked OIDC bearer authenticates as
    // `gideon` (not `isMcpOAuth`). The tenant gate still pins the org and
    // the legacy MCP session is never consulted. The MCP branch below is
    // the shadow-mode backstop for tokens the direct path rejects.
    mockVerify.mockResolvedValue({
      payload: {
        sub: 'gideon-sub-mcp',
        tid: 'org_1',
        email: 'mcp@acme.com',
        aal: 2,
      },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_mcp',
      email: 'mcp@acme.com',
      tenantId: 'org_1',
    });
    mockOrgFindUnique.mockResolvedValue({ id: 'org_1' });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_mcp',
      role: 'admin',
      department: 'it',
    });

    const { context, request } = createContext({
      authorization: 'Bearer gideon.mcp.jwt',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockVerify).toHaveBeenCalledWith('gideon.mcp.jwt');
    expect(mockGetMcpSession).not.toHaveBeenCalled();
    expect(request.authType).toBe('gideon');
    expect(request.isOidcJwt).toBe(true);
    expect(request.oidcAal).toBe(2);
    expect(request.userId).toBe('usr_mcp');
    expect(request.organizationId).toBe('org_1');
    expect(request.userRoles).toEqual(['admin']);
  });

  it('rejects a verified OIDC token whose sub is not linked (no legacy fallback)', async () => {
    // a cryptographically verified OIDC JWT that fails the tenant
    // gate (here: unlinked subject) fails closed — it must not authenticate
    // through the legacy MCP session path.
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-unknown', tid: 'org_1', email: 'x@acme.com' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue(null); // no oidcSub link

    const { context } = createContext({
      authorization: 'Bearer gideon.unknown.jwt',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockGetMcpSession).not.toHaveBeenCalled();
  });

  it('falls back to legacy MCP session for non-OIDC bearers', async () => {
    // Genuinely non-OIDC bearers (opaque/foreign: verify fails AND the
    // token does not present as an OIDC JWT) still use the legacy path.
    mockVerify.mockResolvedValue(null);
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_legacy' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_legacy',
      email: 'legacy@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_leg',
        role: 'owner',
        department: 'it',
        organizationId: 'org_1',
      },
    ]);

    const { context, request } = createContext({
      authorization: 'Bearer opaque_legacy_token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockGetMcpSession).toHaveBeenCalledTimes(1);
    expect(request.isMcpOAuth).toBe(true);
    expect(request.userId).toBe('usr_legacy');
  });

  it('falls back to legacy for a JWT-shaped foreign-issuer bearer', async () => {
    // Three segments but the wrong issuer: not OIDC-presenting, so the
    // legacy path still applies (misconfiguration fail-closed aside).
    mockVerify.mockResolvedValue(null);
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_legacy' });
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_legacy',
      email: 'legacy@acme.com',
      role: 'user',
    });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_leg',
        role: 'owner',
        department: 'it',
        organizationId: 'org_1',
      },
    ]);

    const { context, request } = createContext({
      authorization: 'Bearer foreign.issuer.jwt',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockGetMcpSession).toHaveBeenCalledTimes(1);
    expect(request.isMcpOAuth).toBe(true);
    expect(request.isOidcJwt).toBeUndefined();
    expect(request.userId).toBe('usr_legacy');
  });
});
