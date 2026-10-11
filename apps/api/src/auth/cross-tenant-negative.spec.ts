import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';

// Mocks must precede imports (same pattern as permission.guard.spec.ts).
const mockFindFirst = jest.fn();
jest.mock('@db', () => ({
  CommentEntityType: { task: 'task', finding: 'finding' },
  FindingStatus: {
    open: 'open',
    ready_for_review: 'ready_for_review',
    needs_revision: 'needs_revision',
    closed: 'closed',
  },
  db: {
    finding: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
  },
}));

jest.mock('@gideon-defender/auth', () => ({
  RESTRICTED_ROLES: ['employee', 'contractor'],
  PRIVILEGED_ROLES: ['owner', 'admin', 'auditor'],
}));

const mockHasPermission = jest.fn();
jest.mock('./auth.server', () => ({
  auth: {
    api: { hasPermission: (...args: unknown[]) => mockHasPermission(...args) },
  },
}));

const mockRolesGrant = jest.fn();
jest.mock('./app-access', () => ({
  rolesGrantPermissions: (...args: unknown[]) => mockRolesGrant(...args),
  permissionsGrant: (
    perms: Record<string, string[]>,
    resource: string,
    action: string,
  ) => perms?.[resource]?.includes(action) ?? false,
}));

jest.mock('./service-token.config', () => ({
  resolveServiceByName: () => undefined,
}));

jest.mock('../findings/finding-audit.service', () => ({
  FindingAuditService: class {},
}));
jest.mock('../findings/finding-notifier.service', () => ({
  FindingNotifierService: class {},
}));
jest.mock('../timelines/timelines.service', () => ({
  TimelinesService: class {},
}));
jest.mock('../frameworks/frameworks-timeline.helper', () => ({
  checkAutoCompletePhases: jest.fn(),
}));

import { PermissionGuard } from './permission.guard';
import { CommentsPermissionGuard } from '../comments/comments-permission.guard';
import { OAuthReconnectGuard } from '../integration-platform/guards/oauth-reconnect.guard';
import { FindingsService } from '../findings/findings.service';

function mockContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        url: '/v1/control/ctl_1',
        headers: {},
        organizationId: 'org_b',
        ...request,
      }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function reflectorWith(required: unknown): Reflector {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
  return reflector;
}

beforeEach(() => {
  mockRolesGrant.mockReset();
  mockHasPermission.mockReset();
  mockFindFirst.mockReset();
});

describe('cross-tenant isolation (Phase 2 validation)', () => {
  describe('PermissionGuard', () => {
    const required = [{ resource: 'control', actions: ['read'] }];

    it('denies a session user with no membership roles in the org', async () => {
      const guard = new PermissionGuard(reflectorWith(required));
      mockRolesGrant.mockResolvedValue(false);
      const ctx = mockContext({
        userRoles: [],
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('denies an API key missing the required scope', async () => {
      const guard = new PermissionGuard(reflectorWith(required));
      const ctx = mockContext({
        isApiKey: true,
        apiKeyScopes: ['vendor:read'],
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('denies a session user with null roles (no bypass without membership)', async () => {
      const guard = new PermissionGuard(reflectorWith(required));
      const ctx = mockContext({
        userRoles: null,
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('denies a member whose role lacks the permission', async () => {
      const guard = new PermissionGuard(reflectorWith(required));
      mockRolesGrant.mockResolvedValue(false);
      const ctx = mockContext({
        userRoles: ['employee'],
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('denies a legacy platform-admin flag without org permission', async () => {
      const guard = new PermissionGuard(reflectorWith(required));
      mockRolesGrant.mockResolvedValue(false);
      const ctx = mockContext({
        isPlatformAdmin: true,
        userRoles: ['employee'],
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('CommentsPermissionGuard', () => {
    it('denies a non-member without the resolved permission', async () => {
      const guard = new CommentsPermissionGuard(
        reflectorWith([{ resource: 'task', actions: ['update'] }]),
      );
      mockRolesGrant.mockResolvedValue(false);
      const ctx = mockContext({
        method: 'GET',
        query: { entityType: 'task' },
        userRoles: [],
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('denies a user with null roles and no bypass', async () => {
      const guard = new CommentsPermissionGuard(
        reflectorWith([{ resource: 'task', actions: ['update'] }]),
      );
      const ctx = mockContext({
        method: 'GET',
        query: { entityType: 'task' },
        userRoles: null,
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('OAuthReconnectGuard', () => {
    const guard = new OAuthReconnectGuard();

    it('denies a member lacking integration:update on an existing connection', async () => {
      mockRolesGrant.mockResolvedValue(false);
      const ctx = mockContext({
        body: { connectionId: 'conn_1' },
        userRoles: ['employee'],
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Reconnecting requires integration:update',
      );
    });

    it('leaves the new-connection path open (no connectionId)', async () => {
      const ctx = mockContext({
        body: {},
        userRoles: [],
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('denies a reconnect on a foreign connection without the permission (no bypass)', async () => {
      mockRolesGrant.mockResolvedValue(false);
      const ctx = mockContext({
        body: { connectionId: 'conn_1' },
        userRoles: null,
        organizationId: 'org_b',
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('findings update gate', () => {
    const service = new FindingsService({} as never, {} as never, {} as never);

    beforeEach(() => {
      mockFindFirst.mockResolvedValue({
        id: 'fnd_1',
        organizationId: 'org_b',
        status: 'open',
        type: 'manual',
        content: {},
      });
    });

    it('denies a non-auditor closing a foreign finding', async () => {
      await expect(
        service.update(
          'org_b',
          'fnd_1',
          { status: 'closed' } as never,
          false,
          'usr_1',
          null,
        ),
      ).rejects.toThrow(/Only auditors can/);
    });
  });
});
