import { apiClient } from '@/lib/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signOutFromOidc } from './oidc-sign-out';

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: vi.fn() },
}));

const mockPost = vi.mocked(apiClient.post);

describe('signOutFromOidc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });
  });

  it('revokes through the generic OIDC logout route before redirecting', async () => {
    mockPost.mockResolvedValue({ data: { loggedOut: true }, status: 200 });

    await signOutFromOidc();

    expect(mockPost).toHaveBeenCalledWith('/v1/auth/oidc/logout');
    expect(window.location.href).toBe('/auth');
  });

  it('lands on a custom redirect target when provided', async () => {
    mockPost.mockResolvedValue({ data: { loggedOut: true }, status: 200 });

    await signOutFromOidc({ redirectTo: '/goodbye' });

    expect(window.location.href).toBe('/goodbye');
  });

  it('still navigates away when the logout request fails', async () => {
    mockPost.mockRejectedValue(new Error('network down'));

    await signOutFromOidc();

    expect(window.location.href).toBe('/auth');
  });
});
