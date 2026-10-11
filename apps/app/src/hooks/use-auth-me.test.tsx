import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock apiClient.get only — keep the real unwrapApiData so the fetcher
// under test exercises production code.
const mockGet = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import { useAuthMe } from './use-auth-me';

const mePayload = {
  user: {
    id: 'usr_1',
    email: 'user@acme.com',
    name: 'User',
    image: null,
  },
  organizations: [],
  pendingInvitation: null,
  hasInactiveMembership: false,
  authType: 'session',
};

describe('useAuthMe', () => {
  // Fresh SWR cache per test — otherwise the '/v1/auth/me' key dedupes
  // across tests and later mocks never fire.
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: mePayload, status: 200 });
  });

  it('fetches the current user from GET /v1/auth/me', async () => {
    const { result } = renderHook(() => useAuthMe(), { wrapper });

    await waitFor(() => {
      expect(result.current.user?.id).toBe('usr_1');
    });

    expect(mockGet).toHaveBeenCalledWith('/v1/auth/me');
    expect(result.current.user?.email).toBe('user@acme.com');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('reports an error and null user when the request fails', async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: 'Unauthorized',
      status: 401,
    });

    const { result } = renderHook(() => useAuthMe(), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.user).toBeNull();
  });
});
