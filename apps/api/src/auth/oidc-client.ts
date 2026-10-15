import type * as Oidc from 'openid-client';

export type OidcClient = typeof Oidc;

let cached: OidcClient | null = null;

/**
 * Load the ESM-only `openid-client` v6 module.
 *
 * The dynamic import lives here (and only here) because ts-jest cannot
 * execute native `import()` inside specs — tests mock this loader with a
 * plain static `jest.mock('./oidc-client')` instead.
 */
export async function loadOidcClient(): Promise<OidcClient> {
  if (!cached) {
    cached = await import('openid-client');
  }
  return cached;
}

/** Test-only loader-cache reset. */
export function resetOidcClientCache(): void {
  cached = null;
}
