import { requireRoutePermission } from '@/lib/permissions.server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RolesPage from './page';

const state = vi.hoisted(() => ({
  permissions: {} as Record<string, string[]>,
  get: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/utils/auth', () => ({
  auth: { api: { getSession: async () => ({ user: { id: 'user_1' } }) } },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock('@db/server', () => ({
  db: {
    member: { findFirst: async () => ({ role: 'Delegated Manager' }) },
    organizationRole: { findMany: async () => [{ permissions: state.permissions }] },
  },
}));
vi.mock('@/lib/api-server', () => ({
  serverApi: { get: (...args: unknown[]) => state.get(...args) },
}));
vi.mock('./components/RolesPageClient', () => ({ RolesPageClient: () => null }));

describe('roles page permission guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.get.mockResolvedValue({ data: { builtInRoles: [], customRoles: [] } });
  });

  it.each([{ actions: ['read'] }, { actions: ['read', 'create', 'update', 'delete'] }])(
    'admits delegated role users with $actions and no member permission',
    async ({ actions }) => {
      state.permissions = { app: ['read'], ac: actions };
      await expect(requireRoutePermission('settings', 'org_1')).resolves.toBeUndefined();
      await expect(
        RolesPage({ params: Promise.resolve({ orgId: 'org_1' }) }),
      ).resolves.toBeDefined();
      expect(state.get).toHaveBeenCalledWith('/v1/roles');
    },
  );

  it('redirects member readers without ac:read before it fetches roles', async () => {
    state.permissions = { app: ['read'], member: ['read'] };
    await expect(RolesPage({ params: Promise.resolve({ orgId: 'org_1' }) })).rejects.toThrow(
      'redirect:/org_1/people/all',
    );
    expect(state.get).not.toHaveBeenCalled();
  });
});
