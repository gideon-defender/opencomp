'use client';

import { apiClient } from '@/lib/api-client';
import useSWR, { useSWRConfig } from 'swr';
import type { RoleFormValues } from '../components/RoleForm';
import type { CustomRole } from '../components/RolesTable';

interface RolesResponse {
  builtInRoles: Array<{
    name: string;
    isBuiltIn: boolean;
    description: string;
  }>;
  customRoles: CustomRole[];
}

const rolesListKey = () => ['/v1/roles'] as const;

interface UseRolesOptions {
  initialData?: CustomRole[];
}

export function useRoles({ initialData }: UseRolesOptions = {}) {
  const { data, error, mutate } = useSWR(
    rolesListKey(),
    async () => {
      const response = await apiClient.get<RolesResponse>('/v1/roles');
      if (response.error) throw new Error(response.error);
      return response.data?.customRoles ?? [];
    },
    {
      fallbackData: initialData?.length ? initialData : undefined,
      revalidateOnMount: !initialData?.length,
      revalidateOnFocus: false,
    },
  );

  const roles = Array.isArray(data) ? data : [];

  return {
    roles,
    isLoading: !data && !error && !initialData?.length,
    error,
    mutate,
    ...useRoleMutations(),
  };
}

/**
 * Role mutations without subscribing to the roles list. Mutation-only
 * components must use this hook instead of `useRoles` — every `useRoles`
 * caller opens a second SWR subscription on the same key, and SWR shares
 * the error across subscribers, so a failed background fetch in a
 * mutation-only component flips the whole page to the error screen even
 * when the list data is fine.
 */
export function useRoleMutations() {
  const { mutate } = useSWRConfig();

  async function refreshRoles() {
    const response = await apiClient.get<RolesResponse>('/v1/roles');
    if (response.error) throw new Error(response.error);
    await mutate(rolesListKey(), response.data?.customRoles ?? [], { revalidate: false });
  }

  async function refreshRolesAfterWrite() {
    try {
      await refreshRoles();
    } catch {
      // The write succeeded. Drop stale data so the next page uses its SSR data.
      await mutate(rolesListKey(), undefined, { revalidate: false });
    }
    await mutate((key) => Array.isArray(key) && key[0] === '/v1/roles/permissions', undefined, {
      revalidate: true,
      throwOnError: false,
    });
  }

  async function createRole(values: RoleFormValues) {
    const response = await apiClient.post<CustomRole>('/v1/roles', values);
    if (response.error || !response.data) {
      throw new Error(response.error ?? 'Failed to create role');
    }
    await refreshRolesAfterWrite();
    return response.data;
  }

  async function updateRole(roleId: string, values: RoleFormValues & { confirmRename?: boolean }) {
    const response = await apiClient.patch<CustomRole>(`/v1/roles/${roleId}`, values);
    if (response.error || !response.data) {
      throw new Error(response.error ?? 'Failed to update role');
    }
    await refreshRolesAfterWrite();
    return response.data;
  }

  async function deleteRole(roleId: string) {
    const response = await apiClient.delete<{ id: string; deleted: boolean }>(
      `/v1/roles/${roleId}`,
    );
    if (response.error || !response.data) {
      throw new Error(response.error ?? 'Failed to delete role');
    }
    await refreshRolesAfterWrite();
    return response.data;
  }

  async function fetchRole(roleId: string) {
    const response = await apiClient.get<CustomRole>(`/v1/roles/${roleId}`);
    if (response.error || !response.data) {
      throw new Error(response.error ?? 'Failed to load role');
    }
    return response.data;
  }

  return { createRole, updateRole, deleteRole, fetchRole, refreshRoles };
}
