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

describe('HybridAuthGuard — Gideon JWT (Milestone 2 enforce)', () => {
  let guard: HybridAuthGuard;
  let reflector: Reflector;
  let enforce = false;
  const mockVerify = jest.fn();
  const mockIsGideonToken = jest.fn();
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
    // The Gideon services are @Optional() constructor deps — inject stubs
    // directly so the Bearer path is exercised without JWKS network access.
    const gideonJwtService = {
      isConfigured: () => true,
      isEnforceMode: () => enforce,
      isShadowMode: () => !enforce,
      verify: (...args: unknown[]) => mockVerify(...args),
      isGideonToken: (...args: unknown[]) => mockIsGideonToken(...args),
      resolveTenantId: (payload: { tid?: string }) => payload.tid ?? null,
      resolveUserId: (payload: { sub?: string }) => payload.sub ?? null,
    } as unknown as import('./gideon-jwt.service').GideonJwtService;
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
      gideonJwtService,
      gideonShadowService,
      nativeSessionService,
    );
    mockLogMismatch.mockResolvedValue(undefined);
    // No native/MCP session by default; individual tests opt in.
    // Tokens present as non-Gideon by default; enforce-failure tests opt in.
    mockIsGideonToken.mockReturnValue(false);
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
    // gideonSub → OpenComp user link (provisioned at OIDC first login).
    mockUserFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'gin@acme.com',
    });
    mockOrgFindUnique.mockResolvedValue({ id: 'org_1' });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_1',
      role: 'admin',
      department: 'it',
    });
  }

  it('authenticates a linked Gideon sub and binds org + member', async () => {
    mockLinkedUser();

    const { context, request } = createContext({
      authorization: 'Bearer gideon.jwt.token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // The Gideon `sub` must be resolved through User.gideonSub — never used
    // directly as the OpenComp user id.
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { gideonSub: 'gideon-sub-1' },
      select: { id: true, email: true },
    });
    expect(request.authType).toBe('gideon');
    expect(request.isGideonJwt).toBe(true);
    expect(request.organizationId).toBe('org_1');
    expect(request.userId).toBe('usr_1');
    expect(request.userEmail).toBe('gin@acme.com');
    expect(request.userRoles).toEqual(['admin']);
    expect(request.memberId).toBe('mem_1');
  });

  it('shadow mode: invalid Gideon token falls through to a valid session', async () => {
    mockVerify.mockResolvedValue(null);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', role: 'user' },
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
    expect(request.isGideonJwt).toBeUndefined();
  });

  it('shadow mode: unlinked sub falls through to session (dual-run fallback)', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-unknown', tid: 'org_1' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue(null);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', role: 'user' },
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

  it('enforce mode: invalid Gideon token is a 401 with no session fallback', async () => {
    enforce = true;
    mockVerify.mockResolvedValue(null);
    // Forged token presents as a Gideon JWT (JWT-shaped, matching iss) but
    // fails verification → hard 401.
    mockIsGideonToken.mockReturnValue(true);

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
    mockIsGideonToken.mockReturnValue(false);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', role: 'user' },
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
    expect(request.isGideonJwt).toBeUndefined();
  });

  it('enforce mode: foreign-issuer JWT falls through to session', async () => {
    enforce = true;
    mockVerify.mockResolvedValue(null);
    mockIsGideonToken.mockReturnValue(false);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', role: 'user' },
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
      },
      select: { id: true, role: true, department: true },
    });
    expect(request.organizationId).toBe('tenant-abc');
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
    });
    mockOrgFindUnique.mockResolvedValue(null);
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', role: 'user' },
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

  it('no Bearer header skips Gideon entirely and uses the session', async () => {
    mockNativeResolve.mockResolvedValue({
      user: { id: 'usr_9', email: 'legacy@acme.com', role: 'user' },
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
      user: { id: 'usr_1', email: 'native@acme.com', role: 'user' },
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

describe('HybridAuthGuard — MCP via Gideon JWT (Milestone 3)', () => {
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
    const gideonJwtService = {
      isConfigured: () => true,
      isEnforceMode: () => false,
      isShadowMode: () => true,
      verify: (...args: unknown[]) => mockVerify(...args),
      resolveTenantId: () => null,
      resolveUserId: (payload: { sub?: string }) => payload.sub ?? null,
    } as unknown as import('./gideon-jwt.service').GideonJwtService;
    guard = new HybridAuthGuard(
      apiKeyService,
      reflector,
      gideonJwtService,
      undefined,
      undefined,
    );
    mockGetMcpSession.mockResolvedValue(null);
    mockMcpBindingFindUnique.mockResolvedValue(null);
    mockOrgRoleFindMany.mockResolvedValue([]);
  });

  it('authenticates a Gideon-issued MCP token via the gideonSub link', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-mcp', email: 'mcp@acme.com', aal: 2 },
      protectedHeader: { kid: 'k1' },
    });
    // First user lookup: gideonSub link. Second: MCP org binding by id.
    mockUserFindUnique
      .mockResolvedValueOnce({ id: 'usr_mcp' })
      .mockResolvedValueOnce({
        id: 'usr_mcp',
        email: 'mcp@acme.com',
        role: 'user',
      });
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'mem_mcp',
        role: 'admin',
        department: 'it',
        organizationId: 'org_1',
      },
    ]);

    const { context, request } = createContext({
      authorization: 'Bearer gideon.mcp.jwt',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockVerify).toHaveBeenCalledWith('gideon.mcp.jwt');
    expect(mockGetMcpSession).not.toHaveBeenCalled();
    expect(request.isMcpOAuth).toBe(true);
    expect(request.isGideonJwt).toBe(true);
    expect(request.gideonAal).toBe(2);
    expect(request.userId).toBe('usr_mcp');
    expect(request.organizationId).toBe('org_1');
    expect(request.userRoles).toEqual(['admin']);
  });

  it('falls back to legacy MCP session when the JWT sub is not linked', async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: 'gideon-sub-unknown', email: 'x@acme.com' },
      protectedHeader: { kid: 'k1' },
    });
    mockUserFindUnique.mockResolvedValue(null); // no gideonSub link
    mockGetMcpSession.mockResolvedValue({ userId: 'usr_legacy' });
    mockUserFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
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
      authorization: 'Bearer gideon.unknown.jwt',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockGetMcpSession).toHaveBeenCalledTimes(1);
    expect(request.isMcpOAuth).toBe(true);
    expect(request.userId).toBe('usr_legacy');
  });
});
