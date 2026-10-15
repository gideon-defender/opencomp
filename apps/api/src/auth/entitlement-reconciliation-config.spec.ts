import {
  readReconciliationConfig,
  reconciliationEnabled,
} from './entitlement-reconciliation-config';

const savedEnv = process.env;
beforeEach(() => {
  process.env = {
    ...savedEnv,
    OIDC_ENTITLEMENTS_READER_URL: 'https://identity.example.com',
    OIDC_ENTITLEMENTS_READ_TOKEN: 'reader-key',
    OIDC_CLIENT_ID: 'opencomp',
    OIDC_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY: 'page-key',
    OIDC_ENFORCEMENT_TENANTS: '00000000-0000-0000-0000-000000000001',
  };
  delete process.env.OIDC_ENTITLEMENTS_RECONCILIATION_ENABLED;
  delete process.env.OIDC_ENTITLEMENTS_SKIP_PAGING;
  delete process.env.GIDEON_ENVIRONMENT;
  delete process.env.OIDC_ENFORCEMENT_ALL_TENANTS;
});
afterEach(() => {
  process.env = savedEnv;
});

it('is disabled by default and requires explicit enablement', () => {
  expect(reconciliationEnabled()).toBe(false);
  process.env.OIDC_ENTITLEMENTS_RECONCILIATION_ENABLED = 'true';
  expect(reconciliationEnabled()).toBe(true);
});

it('allows an explicit dev paging opt-out without a fake routing key', () => {
  process.env.GIDEON_ENVIRONMENT = 'dev';
  process.env.OIDC_ENTITLEMENTS_SKIP_PAGING = 'true';
  delete process.env.OIDC_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
  expect(readReconciliationConfig().pagerDutyKey).toBeUndefined();
});

it.each(['prod', '', undefined])(
  'does not permit paging opt-out outside dev (%s)',
  (environment) => {
    if (environment === undefined) delete process.env.GIDEON_ENVIRONMENT;
    else process.env.GIDEON_ENVIRONMENT = environment;
    process.env.OIDC_ENTITLEMENTS_SKIP_PAGING = 'true';
    delete process.env.OIDC_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
    expect(() => readReconciliationConfig()).toThrow('PagerDuty');
  },
);

it('accepts the bootstrap tenant and deduplicates the enforcement allowlist', () => {
  process.env.OIDC_ENFORCEMENT_TENANTS +=
    ', 00000000-0000-0000-0000-000000000001';
  expect(readReconciliationConfig().tenantIds).toEqual([
    '00000000-0000-0000-0000-000000000001',
  ]);
});

it('selects all-tenant inventory explicitly, without requiring a static allowlist', () => {
  process.env.OIDC_ENFORCEMENT_ALL_TENANTS = 'true';
  delete process.env.OIDC_ENFORCEMENT_TENANTS;
  expect(readReconciliationConfig()).toMatchObject({
    allTenants: true,
    tenantIds: [],
  });
});

it.each([
  ['OIDC_ENTITLEMENTS_READ_TOKEN', 'GIDEON_ENTITLEMENTS_READ_TOKEN'],
  ['OIDC_CLIENT_ID', 'GIDEON_OIDC_CLIENT_ID'],
  [
    'OIDC_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY',
    'GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY',
  ],
])('refuses to run without %s', (primary: string, legacy: string) => {
  // Delete the legacy fallback too: test/setup-env.ts loads the real .env
  // and the compat fallback would otherwise fill the gap.
  delete process.env[primary];
  delete process.env[legacy];
  expect(() => readReconciliationConfig()).toThrow('requires');
});

it('fills the gap from GIDEON_* when the OIDC_* primary is unset', () => {
  delete process.env.OIDC_ENTITLEMENTS_READ_TOKEN;
  process.env.GIDEON_ENTITLEMENTS_READ_TOKEN = 'legacy-reader-key';
  expect(readReconciliationConfig().readerToken).toBe('legacy-reader-key');
});

it('falls back to the issuer URL when no reader URL is configured', () => {
  delete process.env.OIDC_ENTITLEMENTS_READER_URL;
  delete process.env.GIDEON_ENTITLEMENTS_READER_URL;
  process.env.OIDC_ISSUER_URL = 'https://issuer.example.com';
  delete process.env.GIDEON_IDENTITY_URL;
  expect(readReconciliationConfig().readerUrl).toBe(
    'https://issuer.example.com',
  );
});

it.each([
  'https://user:secret@identity.example.com',
  'https://identity.example.com?token=secret',
  'file:///tmp/reader',
])('rejects unsafe reader configuration', (url) => {
  process.env.OIDC_ENTITLEMENTS_READER_URL = url;
  expect(() => readReconciliationConfig()).toThrow();
});

it('requires HTTPS in production and rejects a malformed tenant allowlist', () => {
  process.env.NODE_ENV = 'production';
  process.env.OIDC_ENTITLEMENTS_READER_URL = 'http://identity.example.com';
  expect(() => readReconciliationConfig()).toThrow('HTTPS');
  process.env.OIDC_ENTITLEMENTS_READER_URL = 'https://identity.example.com';
  process.env.OIDC_ENFORCEMENT_TENANTS = 'wrong-tenant';
  expect(() => readReconciliationConfig()).toThrow();
});
