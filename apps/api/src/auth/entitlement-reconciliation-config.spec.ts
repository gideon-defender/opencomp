import {
  readReconciliationConfig,
  reconciliationEnabled,
} from './entitlement-reconciliation-config';

const savedEnv = process.env;
beforeEach(() => {
  process.env = {
    ...savedEnv,
    GIDEON_ENTITLEMENTS_READER_URL: 'https://identity.example.com',
    GIDEON_ENTITLEMENTS_READ_TOKEN: 'reader-key',
    GIDEON_OIDC_CLIENT_ID: 'opencomp',
    GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY: 'page-key',
    GIDEON_ENFORCEMENT_TENANTS: '00000000-0000-0000-0000-000000000001',
  };
  delete process.env.GIDEON_ENTITLEMENTS_RECONCILIATION_ENABLED;
  delete process.env.GIDEON_ENTITLEMENTS_SKIP_PAGING;
  delete process.env.GIDEON_ENVIRONMENT;
});
afterEach(() => {
  process.env = savedEnv;
});

it('is disabled by default and requires explicit enablement', () => {
  expect(reconciliationEnabled()).toBe(false);
  process.env.GIDEON_ENTITLEMENTS_RECONCILIATION_ENABLED = 'true';
  expect(reconciliationEnabled()).toBe(true);
});

it('allows an explicit dev paging opt-out without a fake routing key', () => {
  process.env.GIDEON_ENVIRONMENT = 'dev';
  process.env.GIDEON_ENTITLEMENTS_SKIP_PAGING = 'true';
  delete process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
  expect(readReconciliationConfig().pagerDutyKey).toBeUndefined();
});

it.each(['prod', '', undefined])(
  'does not permit paging opt-out outside dev (%s)',
  (environment) => {
    if (environment === undefined) delete process.env.GIDEON_ENVIRONMENT;
    else process.env.GIDEON_ENVIRONMENT = environment;
    process.env.GIDEON_ENTITLEMENTS_SKIP_PAGING = 'true';
    delete process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
    expect(() => readReconciliationConfig()).toThrow('PagerDuty');
  },
);

it('accepts the bootstrap tenant and deduplicates the enforcement allowlist', () => {
  process.env.GIDEON_ENFORCEMENT_TENANTS +=
    ', 00000000-0000-0000-0000-000000000001';
  expect(readReconciliationConfig().tenantIds).toEqual([
    '00000000-0000-0000-0000-000000000001',
  ]);
});

it.each([
  'GIDEON_ENTITLEMENTS_READ_TOKEN',
  'GIDEON_OIDC_CLIENT_ID',
  'GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY',
])('refuses to run without %s', (key) => {
  delete process.env[key];
  expect(() => readReconciliationConfig()).toThrow('requires');
});

it.each([
  'https://user:secret@identity.example.com',
  'https://identity.example.com?token=secret',
  'file:///tmp/reader',
])('rejects unsafe reader configuration', (url) => {
  process.env.GIDEON_ENTITLEMENTS_READER_URL = url;
  expect(() => readReconciliationConfig()).toThrow();
});

it('requires HTTPS in production and rejects a malformed tenant allowlist', () => {
  process.env.NODE_ENV = 'production';
  process.env.GIDEON_ENTITLEMENTS_READER_URL = 'http://identity.example.com';
  expect(() => readReconciliationConfig()).toThrow('HTTPS');
  process.env.GIDEON_ENTITLEMENTS_READER_URL = 'https://identity.example.com';
  process.env.GIDEON_ENFORCEMENT_TENANTS = 'wrong-tenant';
  expect(() => readReconciliationConfig()).toThrow();
});
