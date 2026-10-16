import { Logger } from '@nestjs/common';
import {
  oidcEnv,
  oidcEnvBool,
  oidcJwksCacheTtl,
  oidcJwtAudience,
  oidcJwtIssuer,
  oidcRequireEmailVerified,
  oidcScopes,
  oidcTenantClaimKeys,
  resetOidcEnvWarnings,
} from './oidc-env';

describe('oidc-env', () => {
  const OLD_ENV = { ...process.env };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    resetOidcEnvWarnings();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = OLD_ENV;
    warn.mockRestore();
  });

  it('prefers the OIDC_* primary over the legacy key without warning', () => {
    process.env.OIDC_CLIENT_ID = 'new-id';
    process.env.GIDEON_OIDC_CLIENT_ID = 'old-id';
    expect(oidcEnv('OIDC_CLIENT_ID', 'GIDEON_OIDC_CLIENT_ID')).toBe('new-id');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the legacy key once, warning exactly once', () => {
    delete process.env.OIDC_CLIENT_ID;
    process.env.GIDEON_OIDC_CLIENT_ID = 'old-id';
    expect(oidcEnv('OIDC_CLIENT_ID', 'GIDEON_OIDC_CLIENT_ID')).toBe('old-id');
    expect(oidcEnv('OIDC_CLIENT_ID', 'GIDEON_OIDC_CLIENT_ID')).toBe('old-id');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('GIDEON_OIDC_CLIENT_ID');
    expect(warn.mock.calls[0][0]).toContain('OIDC_CLIENT_ID');
  });

  it('treats blank values as unset so they never shadow a fallback', () => {
    process.env.OIDC_CLIENT_ID = '';
    process.env.GIDEON_OIDC_CLIENT_ID = 'old-id';
    expect(oidcEnv('OIDC_CLIENT_ID', 'GIDEON_OIDC_CLIENT_ID')).toBe('old-id');
  });

  it('uses silent aliases without warning', () => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.GIDEON_IDENTITY_URL;
    process.env.AUTH__IDENTITY_URL = 'https://auth.example.com';
    expect(
      oidcEnv('OIDC_ISSUER_URL', 'GIDEON_IDENTITY_URL', 'AUTH__IDENTITY_URL'),
    ).toBe('https://auth.example.com');
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns undefined when nothing is set', () => {
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.GIDEON_OIDC_CLIENT_ID;
    expect(oidcEnv('OIDC_CLIENT_ID', 'GIDEON_OIDC_CLIENT_ID')).toBeUndefined();
  });

  it('parses boolean flags strictly', () => {
    process.env.OIDC_JWT_ENABLED = 'true';
    expect(oidcEnvBool('OIDC_JWT_ENABLED', 'GIDEON_JWT_ENABLED')).toBe(true);
    process.env.OIDC_JWT_ENABLED = '1';
    expect(oidcEnvBool('OIDC_JWT_ENABLED', 'GIDEON_JWT_ENABLED')).toBe(false);
  });

  it('returns undefined tenant-claim keys when unset (caller uses defaults)', () => {
    delete process.env.OIDC_TENANT_CLAIM;
    delete process.env.GIDEON_TENANT_CLAIM;
    expect(oidcTenantClaimKeys()).toBeUndefined();
  });

  it('parses a custom tenant-claim list, ignoring blanks', () => {
    process.env.OIDC_TENANT_CLAIM = ' tid ,, custom_tenant ';
    expect(oidcTenantClaimKeys()).toEqual(['tid', 'custom_tenant']);
  });

  it('returns undefined on a blank claim list', () => {
    process.env.OIDC_TENANT_CLAIM = ' , ';
    expect(oidcTenantClaimKeys()).toBeUndefined();
  });

  it('requires verified email by default, opt-out with false', () => {
    delete process.env.OIDC_REQUIRE_EMAIL_VERIFIED;
    delete process.env.GIDEON_REQUIRE_EMAIL_VERIFIED;
    expect(oidcRequireEmailVerified()).toBe(true);
    process.env.OIDC_REQUIRE_EMAIL_VERIFIED = 'false';
    expect(oidcRequireEmailVerified()).toBe(false);
  });

  it('falls back to the legacy boolean flag without warning on the primary', () => {
    delete process.env.OIDC_JWT_ENABLED;
    process.env.GIDEON_JWT_ENABLED = 'true';
    expect(oidcEnvBool('OIDC_JWT_ENABLED', 'GIDEON_JWT_ENABLED')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('skips a blank legacy value and keeps looking', () => {
    delete process.env.OIDC_CLIENT_ID;
    process.env.GIDEON_OIDC_CLIENT_ID = '';
    process.env.AUTH__IDENTITY_URL = 'https://auth.example.com';
    expect(
      oidcEnv('OIDC_CLIENT_ID', 'GIDEON_OIDC_CLIENT_ID', 'AUTH__IDENTITY_URL'),
    ).toBe('https://auth.example.com');
  });

  it('defaults scopes when unset or blank', () => {
    delete process.env.OIDC_SCOPES;
    delete process.env.GIDEON_OIDC_SCOPES;
    expect(oidcScopes()).toBe('openid profile email');
    process.env.OIDC_SCOPES = '';
    expect(oidcScopes()).toBe('openid profile email');
    process.env.OIDC_SCOPES = 'openid custom';
    expect(oidcScopes()).toBe('openid custom');
  });

  it('returns null issuer/audience when neither primary nor fallback is set', () => {
    delete process.env.OIDC_JWT_ISSUER;
    delete process.env.GIDEON_JWT_ISSUER;
    delete process.env.JWT_ISSUER;
    delete process.env.OIDC_JWT_AUDIENCE;
    delete process.env.GIDEON_JWT_AUDIENCE;
    delete process.env.JWT_AUDIENCE;
    expect(oidcJwtIssuer()).toBeNull();
    expect(oidcJwtAudience()).toBeNull();
  });

  it('reads issuer/audience from silent aliases without warning', () => {
    delete process.env.OIDC_JWT_ISSUER;
    delete process.env.GIDEON_JWT_ISSUER;
    process.env.JWT_ISSUER = 'https://auth.example.com';
    delete process.env.OIDC_JWT_AUDIENCE;
    delete process.env.GIDEON_JWT_AUDIENCE;
    process.env.JWT_AUDIENCE = 'my-app';
    expect(oidcJwtIssuer()).toBe('https://auth.example.com');
    expect(oidcJwtAudience()).toBe('my-app');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to deprecated GIDEON_* issuer/audience with warning', () => {
    delete process.env.OIDC_JWT_ISSUER;
    process.env.GIDEON_JWT_ISSUER = 'https://auth.example.com';
    delete process.env.JWT_ISSUER;
    delete process.env.OIDC_JWT_AUDIENCE;
    process.env.GIDEON_JWT_AUDIENCE = 'my-app';
    delete process.env.JWT_AUDIENCE;
    expect(oidcJwtIssuer()).toBe('https://auth.example.com');
    expect(oidcJwtAudience()).toBe('my-app');
    expect(warn).toHaveBeenCalled();
  });

  it('honors the legacy email-verified opt-out', () => {
    delete process.env.OIDC_REQUIRE_EMAIL_VERIFIED;
    process.env.GIDEON_REQUIRE_EMAIL_VERIFIED = 'false';
    expect(oidcRequireEmailVerified()).toBe(false);
  });

  it('defaults the JWKS cache TTL to 300s when unset', () => {
    delete process.env.OIDC_JWKS_CACHE_TTL_SECS;
    delete process.env.GIDEON_JWKS_CACHE_TTL_SECS;
    delete process.env.AUTH__JWKS_CACHE_TTL_SECS;
    expect(oidcJwksCacheTtl()).toBe(300);
  });

  it('parses the JWKS cache TTL, falling back on invalid values', () => {
    process.env.OIDC_JWKS_CACHE_TTL_SECS = '60';
    expect(oidcJwksCacheTtl()).toBe(60);
    process.env.OIDC_JWKS_CACHE_TTL_SECS = '0';
    expect(oidcJwksCacheTtl()).toBe(300);
    process.env.OIDC_JWKS_CACHE_TTL_SECS = '-5';
    expect(oidcJwksCacheTtl()).toBe(300);
    process.env.OIDC_JWKS_CACHE_TTL_SECS = 'not-a-number';
    expect(oidcJwksCacheTtl()).toBe(300);
  });
});
