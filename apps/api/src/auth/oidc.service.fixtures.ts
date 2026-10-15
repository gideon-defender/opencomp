/**
 * Shared OIDC test doubles for the login specs. The `jest.mock()` calls
 * themselves stay in each spec file (jest requires them there); this module
 * holds the mock functions, env, and exchange helpers they wire up.
 */
import { Test } from '@nestjs/testing';
import { OidcService } from './oidc.service';
export const mockDiscovery = jest.fn();
export const mockBuildAuthorizationUrl = jest.fn();
export const mockAuthorizationCodeGrant = jest.fn();
export const mockFetchUserInfo = jest.fn();
export const mockTokenRevocation = jest.fn();

export const mockOidc = {
  discovery: (...args: unknown[]) => mockDiscovery(...args),
  buildAuthorizationUrl: (...args: unknown[]) =>
    mockBuildAuthorizationUrl(...args),
  authorizationCodeGrant: (...args: unknown[]) =>
    mockAuthorizationCodeGrant(...args),
  fetchUserInfo: (...args: unknown[]) => mockFetchUserInfo(...args),
  tokenRevocation: (...args: unknown[]) => mockTokenRevocation(...args),
  randomPKCECodeVerifier: () => 'verifier-123',
  calculatePKCECodeChallenge: () => Promise.resolve('challenge-123'),
  randomState: () => 'state-123',
  randomNonce: () => 'nonce-123',
  allowInsecureRequests: jest.fn(),
};

export const mockRedisSet = jest.fn();
export const mockRedisGetdel = jest.fn();
export const mockRedisGet = jest.fn();

export const mockUserFindUnique = jest.fn();
export const mockUserFindFirst = jest.fn();
// Expand-window fallbacks run a nulls-first raw lookup ($queryRaw) with an
// in-code ownership pick. Default to no candidates: clearAllMocks (used by
// every spec here) preserves implementations, so this survives as the
// default and individual tests override with Once values as needed.
export const mockUserFindMany = jest.fn();
mockUserFindMany.mockResolvedValue([]);
export const mockQueryRaw = jest.fn();
mockQueryRaw.mockResolvedValue([]);
export const mockUserCreate = jest.fn();
export const mockUserUpdate = jest.fn();
export const mockOrgFindFirst = jest.fn();
export const mockOrgFindUnique = jest.fn();
export const mockMemberFindFirst = jest.fn();
export const mockSessionCreate = jest.fn();
export const mockSessionFindUnique = jest.fn();
export const mockSessionDelete = jest.fn();

export const ENV = {
  OIDC_ISSUER_URL: 'http://localhost:8080',
  OIDC_CLIENT_ID: 'opencomp-dev',
  OIDC_CLIENT_SECRET: 'secret-123',
  OIDC_REDIRECT_URI: 'http://localhost:3333/v1/auth/oidc/callback',
};

export function mockSuccessfulExchange() {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  // Tenant-scoped login: the access token carries the tenant (== org id) so
  // provisioning can assign immutable ownership. Tests that need a different
  // tenant override the grant afterwards (see the tenant-stamp test).
  const accessToken = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
    sub: 'gideon-sub-1',
    tid: 'org_1',
  })}.sig`;
  mockRedisGetdel.mockResolvedValue({
    codeVerifier: 'verifier-123',
    nonce: 'nonce-123',
    redirectTo: '/risks',
  });
  mockAuthorizationCodeGrant.mockResolvedValue({
    access_token: accessToken,
    refresh_token: 'refresh-1',
    claims: () => ({ sub: 'gideon-sub-1' }),
  });
  mockFetchUserInfo.mockResolvedValue({
    sub: 'gideon-sub-1',
    email: 'ada@example.com',
    email_verified: true,
    name: 'Ada',
  });
  mockOrgFindFirst.mockResolvedValue({ id: 'org_1' });
  mockOrgFindUnique.mockResolvedValue({ id: 'org_1' });
  mockMemberFindFirst.mockResolvedValue({ id: 'mem_1' });
  mockUserFindUnique.mockResolvedValue(null);
  mockUserFindMany.mockResolvedValue([]);
  mockQueryRaw.mockResolvedValue([]);
  mockSessionCreate.mockResolvedValue({
    token: 'ses-token',
    expiresAt: new Date('2026-09-22T00:00:00Z'),
  });
}

export const CALLBACK_URL = `${ENV.OIDC_REDIRECT_URI}?code=auth-code&state=state-123`;

/** Fresh service with discovery pre-stubbed and cache reset. */
export async function createOidcService(): Promise<OidcService> {
  mockDiscovery.mockResolvedValue('mock-config');
  mockBuildAuthorizationUrl.mockReturnValue(
    new URL('http://localhost:8080/v1/oidc/authorize?code_challenge=x'),
  );
  const module = await Test.createTestingModule({
    providers: [OidcService],
  }).compile();
  const service = module.get(OidcService);
  service.resetCache();
  return service;
}
