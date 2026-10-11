import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// Mock @db before importing the guard so the Prisma client doesn't try to
// initialize against a real DATABASE_URL in this unit-test env.
jest.mock('@db', () => ({
  CommentEntityType: {
    task: 'task',
    vendor: 'vendor',
    risk: 'risk',
    policy: 'policy',
    finding: 'finding',
  },
}));

// Mock the permission.guard module so we don't pull better-auth's init chain
// (the guard only borrows the PERMISSIONS_KEY constant + RequiredPermission
// type — both safe to redefine here).
jest.mock('../auth/permission.guard', () => ({
  PERMISSIONS_KEY: 'permissions',
}));

const resolveServiceByNameMock = jest.fn();
jest.mock('../auth/service-token.config', () => ({
  resolveServiceByName: (...args: unknown[]) =>
    resolveServiceByNameMock(...args),
}));

jest.mock('../auth/auth.server', () => ({
  auth: { api: { hasPermission: jest.fn() } },
}));

// Milestone 3 — the guard prefers the native role check when HybridAuthGuard
// resolved roles. Mock app-access so the spec doesn't pull in @db.
const rolesGrantPermissionsMock = jest.fn();
jest.mock('../auth/app-access', () => ({
  rolesGrantPermissions: (...args: unknown[]) =>
    rolesGrantPermissionsMock(...args),
}));

import { CommentsPermissionGuard } from './comments-permission.guard';
import { auth } from '../auth/auth.server';

type MockRequest = {
  method: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
  isApiKey?: boolean;
  isServiceToken?: boolean;
  userRoles?: string[] | null;
  organizationId?: string;
};

function makeContext(request: MockRequest): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

const hasPermissionMock = auth.api.hasPermission as unknown as jest.Mock;

function reflectorWith(resource: string, action: string): Reflector {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockReturnValue([{ resource, actions: [action] }]);
  return reflector;
}

describe('CommentsPermissionGuard', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    rolesGrantPermissionsMock.mockReset();
  });

  it('resolves entityType from POST body and checks finding:update when finding', async () => {
    hasPermissionMock.mockResolvedValueOnce({ success: true });
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'finding' },
      headers: { cookie: 'session=abc' },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          permissions: { finding: ['update'] },
        }),
      }),
    );
  });

  it('resolves entityType from GET query and checks finding:read when finding', async () => {
    hasPermissionMock.mockResolvedValueOnce({ success: true });
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'read'));
    const context = makeContext({
      method: 'GET',
      query: { entityType: 'finding' },
      headers: { cookie: 'session=abc' },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          permissions: { finding: ['read'] },
        }),
      }),
    );
  });

  it('falls back to the metadata resource when entityType is missing (PUT)', async () => {
    hasPermissionMock.mockResolvedValueOnce({ success: true });
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'PUT',
      body: { content: 'edit' },
      headers: { cookie: 'session=abc' },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          permissions: { task: ['update'] },
        }),
      }),
    );
  });

  it('falls back to the metadata resource for unknown entityType values', async () => {
    hasPermissionMock.mockResolvedValueOnce({ success: true });
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'not-an-entity' },
      headers: { cookie: 'session=abc' },
    });
    await guard.canActivate(context);
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          permissions: { task: ['update'] },
        }),
      }),
    );
  });

  it('throws ForbiddenException when better-auth rejects', async () => {
    hasPermissionMock.mockResolvedValueOnce({ success: false });
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'finding' },
      headers: { cookie: 'session=abc' },
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows API keys whose scopes include the resolved permission', async () => {
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'finding' },
      headers: {},
      isApiKey: true,
    });
    // Inject explicit scope set on the request — entityType=finding requires
    // `finding:update`, NOT `task:update`.
    context.switchToHttp().getRequest().apiKeyScopes = ['finding:update'];
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('rejects API keys whose scopes do not include the resolved permission (no bypass)', async () => {
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'finding' },
      headers: {},
      isApiKey: true,
    });
    context.switchToHttp().getRequest().apiKeyScopes = ['task:update']; // wrong scope
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects service tokens whose allowlist lacks the resolved permission', async () => {
    resolveServiceByNameMock.mockReturnValueOnce({
      permissions: ['task:update'],
    });
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'finding' },
      headers: {},
      isServiceToken: true,
    });
    context.switchToHttp().getRequest().serviceName = 'svc-test';
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows service tokens whose allowlist includes the resolved permission', async () => {
    resolveServiceByNameMock.mockReturnValueOnce({
      permissions: ['finding:update'],
    });
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'finding' },
      headers: {},
      isServiceToken: true,
    });
    context.switchToHttp().getRequest().serviceName = 'svc-test';
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('returns true when no @RequirePermission metadata is set (endpoint opted out)', async () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new CommentsPermissionGuard(reflector);
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'finding' },
      headers: {},
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('uses the native role check when HybridAuthGuard resolved roles', async () => {
    rolesGrantPermissionsMock.mockResolvedValueOnce(true);
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'finding' },
      headers: { cookie: 'session=abc' },
      userRoles: ['auditor'],
      organizationId: 'org_1',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rolesGrantPermissionsMock).toHaveBeenCalledWith({
      organizationId: 'org_1',
      roles: ['auditor'],
      required: { finding: ['update'] },
    });
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('denies natively when resolved roles lack the permission', async () => {
    rolesGrantPermissionsMock.mockResolvedValueOnce(false);
    const guard = new CommentsPermissionGuard(reflectorWith('task', 'update'));
    const context = makeContext({
      method: 'POST',
      body: { entityType: 'finding' },
      headers: { cookie: 'session=abc' },
      userRoles: ['auditor'],
      organizationId: 'org_1',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });
});
