import { apiClient } from '@/lib/api-client';

interface SignOutFromOidcOptions {
  /** Where to land after the session is revoked. Defaults to the login page. */
  redirectTo?: string;
}

/**
 * OIDC sign-out.
 *
 * POSTs to the API's logout endpoint (revokes identity-provider tokens, deletes the
 * session row, clears the session cookie — cookies are sent via
 * `credentials: 'include'`), then hard-navigates away. A full page load
 * (not `router.push`) guarantees no stale authenticated client state
 * survives the sign-out.
 */
export async function signOutFromOidc(options: SignOutFromOidcOptions = {}): Promise<void> {
  const { redirectTo = '/auth' } = options;
  try {
    await apiClient.post('/v1/auth/oidc/logout');
  } catch {
    // Best-effort revocation: the session may already be gone (or the API
    // unreachable). Still navigate away — never strand the user.
  } finally {
    // Hard nav is required here (see docstring): router.push would keep
    // stale authenticated client state alive after sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- hard navigation required, see above
    window.location.href = redirectTo;
  }
}
