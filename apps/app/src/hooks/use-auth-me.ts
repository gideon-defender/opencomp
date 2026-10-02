'use client';

import { apiClient, unwrapApiData } from '@/lib/api-client';
import useSWR from 'swr';

/** User shape returned by `GET /v1/auth/me` (see `AuthController.getMe`). */
export interface AuthMeUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string | null;
}

export interface AuthMeData {
  user: AuthMeUser | null;
  pendingInvitation: { id: string } | null;
  hasInactiveMembership: boolean;
  impersonatedBy: string | null;
  authType: string | null;
}

/**
 * Milestone 2 — session-neutral current-user hook.
 *
 * Reads `GET /v1/auth/me`, which resolves for both legacy better-auth
 * sessions and Gideon-minted sessions, instead of better-auth's
 * `useSession` — so UI code no longer depends on better-auth session
 * resolution and the library can be deleted in Milestone 3 untouched.
 */
export function useAuthMe() {
  const { data, error, isLoading, mutate } = useSWR<AuthMeData>('/v1/auth/me', fetchAuthMe, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });

  return {
    user: data?.user ?? null,
    impersonatedBy: data?.impersonatedBy ?? null,
    authType: data?.authType ?? null,
    hasInactiveMembership: data?.hasInactiveMembership ?? false,
    isLoading,
    isError: error !== undefined,
    mutate,
  };
}

async function fetchAuthMe(): Promise<AuthMeData> {
  const res = await apiClient.get<AuthMeData>('/v1/auth/me');
  return unwrapApiData({ response: res, fallbackError: 'Failed to load current user' });
}
