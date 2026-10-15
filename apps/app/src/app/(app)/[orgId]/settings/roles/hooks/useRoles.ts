'use client';

import { apiClient } from '@/lib/api-client';
import useSWR from 'swr';
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

  // IdP-owned user management: role writes are Gideon-synced. There is no
  // local role-write endpoint. No local mutation helpers — read-only.
  return {
    roles,
    isLoading: !data && !error && !initialData,
    error,
    mutate,
  };
}
