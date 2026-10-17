import { usePermissions } from '@/hooks/use-permissions';
import { apiClient } from '@/lib/api-client';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoleMutations } from './useRoles';

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/utils/auth-client', () => ({
  useActiveMember: () => ({ data: { role: 'Delegated Manager' } }),
}));

const values = {
  name: 'Delegated Manager',
  permissions: { ac: ['read', 'update'] },
  obligations: { compliance: false },
};

function createWrapper() {
  const cache = new Map();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>
        {children}
      </SWRConfig>
    );
  };
}

describe('effective permissions after role writes', () => {
  let changed: boolean;
  let listFails: boolean;

  beforeEach(() => {
    vi.resetAllMocks();
    changed = false;
    listFails = false;
    vi.mocked(apiClient.get).mockImplementation(async (path) => {
      if (path.startsWith('/v1/roles/permissions?')) {
        return {
          status: 200,
          data: changed
            ? { permissions: values.permissions, obligations: values.obligations }
            : {
                permissions: { ...values.permissions, evidence: ['read'] },
                obligations: { compliance: true },
              },
        };
      }
      return listFails
        ? { status: 503, error: 'List unavailable' }
        : { status: 200, data: { customRoles: [] } };
    });
    const succeed = async () => {
      changed = true;
      return { status: 200, data: { id: 'rol_1', ...values } };
    };
    vi.mocked(apiClient.patch).mockImplementation(succeed);
    vi.mocked(apiClient.post).mockImplementation(succeed);
    vi.mocked(apiClient.delete).mockImplementation(succeed);
  });

  it.each(['create', 'update', 'delete'])(
    'refreshes mounted permissions and obligations after %s',
    async (operation) => {
      const { result } = renderHook(
        () => ({
          permissions: usePermissions(),
          mutations: useRoleMutations(),
        }),
        { wrapper: createWrapper() },
      );
      await waitFor(() =>
        expect(result.current.permissions.hasPermission('evidence', 'read')).toBe(true),
      );
      expect(result.current.permissions.obligations.compliance).toBe(true);

      await act(async () => {
        if (operation === 'create') await result.current.mutations.createRole(values);
        if (operation === 'update') await result.current.mutations.updateRole('rol_1', values);
        if (operation === 'delete') await result.current.mutations.deleteRole('rol_1');
      });

      await waitFor(() =>
        expect(result.current.permissions.hasPermission('evidence', 'read')).toBe(false),
      );
      expect(result.current.permissions.obligations.compliance).toBeUndefined();
      expect(result.current.permissions.hasPermission('ac', 'update')).toBe(true);
    },
  );

  it('refreshes permissions even when the role list refresh fails', async () => {
    const { result } = renderHook(
      () => ({
        permissions: usePermissions(),
        mutations: useRoleMutations(),
      }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(result.current.permissions.hasPermission('evidence', 'read')).toBe(true),
    );
    listFails = true;

    await act(async () => {
      await expect(result.current.mutations.updateRole('rol_1', values)).resolves.toHaveProperty(
        'id',
        'rol_1',
      );
    });

    await waitFor(() =>
      expect(result.current.permissions.hasPermission('evidence', 'read')).toBe(false),
    );
  });
});
