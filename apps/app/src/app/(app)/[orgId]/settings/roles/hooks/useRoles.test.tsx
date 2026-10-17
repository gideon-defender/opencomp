import { apiClient } from '@/lib/api-client';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleFormValues } from '../components/RoleForm';
import type { CustomRole } from '../components/RolesTable';
import { useRoleMutations, useRoles } from './useRoles';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);

const role: CustomRole = {
  id: 'rol_1',
  name: 'Compliance Lead',
  permissions: { control: ['read'] },
  obligations: {},
  isBuiltIn: false,
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
  _count: { members: 0 },
};

const values: RoleFormValues = {
  name: 'Compliance Lead',
  permissions: { control: ['read'] },
  obligations: {},
};

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
    );
  };
}

describe('useRoleMutations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGet.mockResolvedValue({
      data: { builtInRoles: [], customRoles: [role] },
      status: 200,
    });
  });

  it('creates a role via POST /v1/roles', async () => {
    mockPost.mockResolvedValueOnce({ data: role, error: undefined, status: 201 });
    const { result } = renderHook(() => useRoleMutations());

    const created = await result.current.createRole(values);

    expect(mockPost).toHaveBeenCalledWith('/v1/roles', values);
    expect(created).toEqual(role);
  });

  it('throws the server message when create fails', async () => {
    mockPost.mockResolvedValueOnce({
      error: 'Role "Compliance Lead" already exists in this organization',
      status: 409,
    });
    const { result } = renderHook(() => useRoleMutations());

    await expect(result.current.createRole(values)).rejects.toThrow('already exists');
  });

  it('throws a default message when create returns no data', async () => {
    mockPost.mockResolvedValueOnce({ status: 201 });
    const { result } = renderHook(() => useRoleMutations());

    await expect(result.current.createRole(values)).rejects.toThrow('Failed to create role');
  });

  it('updates a role via PATCH /v1/roles/:id, including confirmRename', async () => {
    mockPatch.mockResolvedValueOnce({ data: role, error: undefined, status: 200 });
    const { result } = renderHook(() => useRoleMutations());

    const updated = await result.current.updateRole('rol_1', {
      ...values,
      confirmRename: true,
    });

    expect(mockPatch).toHaveBeenCalledWith(
      '/v1/roles/rol_1',
      expect.objectContaining({ confirmRename: true }),
    );
    expect(updated).toEqual(role);
  });

  it('throws the server message when update fails', async () => {
    mockPatch.mockResolvedValueOnce({ error: 'Role not found: rol_9', status: 404 });
    const { result } = renderHook(() => useRoleMutations());

    await expect(result.current.updateRole('rol_9', values)).rejects.toThrow(
      'Role not found: rol_9',
    );
  });

  it('deletes a role via DELETE /v1/roles/:id', async () => {
    mockDelete.mockResolvedValueOnce({
      data: { id: 'rol_1', deleted: true },
      error: undefined,
      status: 200,
    });
    const { result } = renderHook(() => useRoleMutations());

    const deleted = await result.current.deleteRole('rol_1');

    expect(mockDelete).toHaveBeenCalledWith('/v1/roles/rol_1');
    expect(deleted).toEqual({ id: 'rol_1', deleted: true });
  });

  it('throws the server message when delete is blocked by holders', async () => {
    mockDelete.mockResolvedValueOnce({
      error: 'Cannot delete role "Lead": 2 members currently hold it.',
      status: 409,
    });
    const { result } = renderHook(() => useRoleMutations());

    await expect(result.current.deleteRole('rol_1')).rejects.toThrow('2 members currently hold it');
  });

  it('fetches a single role via GET /v1/roles/:id', async () => {
    mockGet.mockResolvedValueOnce({ data: role, error: undefined, status: 200 });
    const { result } = renderHook(() => useRoleMutations());

    const fetched = await result.current.fetchRole('rol_1');

    expect(mockGet).toHaveBeenCalledWith('/v1/roles/rol_1');
    expect(fetched).toEqual(role);
  });

  it('throws when fetching a role fails', async () => {
    mockGet.mockResolvedValueOnce({ error: 'Role not found: rol_9', status: 404 });
    const { result } = renderHook(() => useRoleMutations());

    await expect(result.current.fetchRole('rol_9')).rejects.toThrow('Role not found: rol_9');
  });

  it('refreshRoles resolves without throwing', async () => {
    const { result } = renderHook(() => useRoleMutations());

    await expect(result.current.refreshRoles()).resolves.toBeUndefined();
  });

  it('refreshes a cached empty list while its page is unmounted', async () => {
    const cache = new Map();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
    );
    mockGet.mockResolvedValueOnce({
      data: { builtInRoles: [], customRoles: [] },
      status: 200,
    });
    const list = renderHook(() => useRoles(), { wrapper });
    await waitFor(() => expect(list.result.current.isLoading).toBe(false));
    expect(list.result.current.roles).toEqual([]);
    list.unmount();
    mockPost.mockResolvedValueOnce({ data: role, status: 201 });
    const mutations = renderHook(() => useRoleMutations(), { wrapper });

    await act(async () => {
      await mutations.result.current.createRole(values);
    });
    mutations.unmount();
    const returned = renderHook(() => useRoles({ initialData: [role] }), { wrapper });

    expect(returned.result.current.roles).toEqual([role]);
  });

  it('keeps a successful write successful if the list refresh fails', async () => {
    mockPost.mockResolvedValueOnce({ data: role, status: 201 });
    mockGet.mockResolvedValueOnce({ error: 'Temporary outage', status: 503 });
    const { result } = renderHook(() => useRoleMutations(), { wrapper: createWrapper() });

    await expect(result.current.createRole(values)).resolves.toEqual(role);
  });
});

describe('useRoles', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns custom roles from the list endpoint', async () => {
    mockGet.mockResolvedValueOnce({
      data: { builtInRoles: [], customRoles: [role] },
      error: undefined,
      status: 200,
    });
    const { result } = renderHook(() => useRoles(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.roles).toEqual([role]));
    expect(result.current.isLoading).toBe(false);
  });

  it('returns an empty list when the payload has no role array', async () => {
    mockGet.mockResolvedValueOnce({ data: {}, error: undefined, status: 200 });
    const { result } = renderHook(() => useRoles(), { wrapper: createWrapper() });

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roles).toEqual([]);
  });

  it('surfaces fetch errors', async () => {
    mockGet.mockResolvedValueOnce({ error: 'Failed to load roles', status: 500 });
    const { result, unmount } = renderHook(() => useRoles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.roles).toEqual([]);
    unmount();
  });
});
