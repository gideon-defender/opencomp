import {
  isJwtShaped,
  resolveOidcAal,
  resolveOidcTenantClaim,
} from './oidc-tenant-claim';

/**
 * Phase 0 tenant-claim contract (Gram auth cutover): the tenant resolves
 * from verified Gideon claims `tid` / `tenant_id` / `organizationId` /
 * `tenantId`. Missing, malformed or conflicting claims reject the token —
 * any alternative mapping needs an approved mapping contract.
 */
describe('resolveOidcTenantClaim (Phase 0 contract)', () => {
  it('resolves each accepted alias on its own', () => {
    expect(resolveOidcTenantClaim({ tid: 'org_1' })).toEqual({
      ok: true,
      tenantId: 'org_1',
    });
    expect(resolveOidcTenantClaim({ tenant_id: 'org_2' })).toEqual({
      ok: true,
      tenantId: 'org_2',
    });
    expect(resolveOidcTenantClaim({ organizationId: 'org_3' })).toEqual({
      ok: true,
      tenantId: 'org_3',
    });
    expect(resolveOidcTenantClaim({ tenantId: 'org_4' })).toEqual({
      ok: true,
      tenantId: 'org_4',
    });
  });

  it('rejects a missing tenant claim', () => {
    const result = resolveOidcTenantClaim({ sub: 'u' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing');
  });

  it.each([
    ['tid', 123],
    ['tenant_id', 123],
    ['organizationId', 123],
    ['tenantId', 123],
    ['tid', ''],
    ['tenant_id', '   '],
    ['organizationId', ['x']],
    ['tenantId', { id: 'x' }],
  ])('rejects a malformed tenant claim (%s=%j)', (key, value) => {
    const result = resolveOidcTenantClaim({ [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it.each([
    ['tid', 'tenant_id'],
    ['tid', 'organizationId'],
    ['tid', 'tenantId'],
    ['tenant_id', 'organizationId'],
  ])('rejects conflicting aliases (%s vs %s)', (first, second) => {
    const result = resolveOidcTenantClaim({
      [first]: 'org_a',
      [second]: 'org_b',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('conflict');
  });

  it('rejects conflicting claim aliases with distinct values', () => {
    const result = resolveOidcTenantClaim({
      tid: 'org_a',
      tenant_id: 'org_b',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('conflict');
  });

  it('accepts agreeing aliases and trims whitespace', () => {
    expect(
      resolveOidcTenantClaim({ tid: 'org_1', tenant_id: 'org_1' }),
    ).toEqual({ ok: true, tenantId: 'org_1' });
    expect(resolveOidcTenantClaim({ tid: '  org_1  ' })).toEqual({
      ok: true,
      tenantId: 'org_1',
    });
  });

  it('ignores null/undefined aliases when another alias resolves', () => {
    expect(resolveOidcTenantClaim({ tid: null, tenant_id: 'org_1' })).toEqual({
      ok: true,
      tenantId: 'org_1',
    });
  });
});

describe('resolveOidcTenantClaim with OIDC_TENANT_CLAIM configured', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('honors a custom claim list', () => {
    process.env.OIDC_TENANT_CLAIM = 'custom_tid';
    expect(resolveOidcTenantClaim({ custom_tid: 'org_9' })).toEqual({
      ok: true,
      tenantId: 'org_9',
    });
  });

  it('ignores default keys once overridden', () => {
    process.env.OIDC_TENANT_CLAIM = 'custom_tid';
    const result = resolveOidcTenantClaim({ tid: 'org_1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing');
  });

  it('keeps strict conflict semantics on custom keys', () => {
    process.env.OIDC_TENANT_CLAIM = 'custom_tid,other_tid';
    const result = resolveOidcTenantClaim({
      custom_tid: 'a',
      other_tid: 'b',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('conflict');
  });

  it('falls back to the default keys on a blank claim list', () => {
    process.env.OIDC_TENANT_CLAIM = ' , ';
    delete process.env.GIDEON_TENANT_CLAIM;
    expect(resolveOidcTenantClaim({ tid: 'org_1' })).toEqual({
      ok: true,
      tenantId: 'org_1',
    });
  });

  it('reads the legacy claim list when the primary is unset', () => {
    delete process.env.OIDC_TENANT_CLAIM;
    process.env.GIDEON_TENANT_CLAIM = 'custom_tid';
    expect(resolveOidcTenantClaim({ custom_tid: 'org_9' })).toEqual({
      ok: true,
      tenantId: 'org_9',
    });
  });
});

describe('isJwtShaped', () => {
  it('accepts 3-segment bearers and rejects everything else', () => {
    expect(isJwtShaped('header.payload.sig')).toBe(true);
    expect(isJwtShaped('opaque_legacy_token')).toBe(false);
    expect(isJwtShaped('two.segments')).toBe(false);
    expect(isJwtShaped('')).toBe(false);
    expect(isJwtShaped('a.b.c.d')).toBe(false);
    // Degenerate shapes: an empty middle segment still has 3 segments, and
    // callers trim before checking — pin both so a future strictness change
    // shows up here.
    expect(isJwtShaped('a..c')).toBe(true);
    expect(isJwtShaped('  a.b.c  ')).toBe(true);
  });
});

describe('resolveOidcAal', () => {
  it('passes finite numbers through', () => {
    expect(resolveOidcAal(2)).toBe(2);
    expect(resolveOidcAal(0)).toBe(0);
    expect(resolveOidcAal(NaN)).toBeUndefined();
    expect(resolveOidcAal(Infinity)).toBeUndefined();
    expect(resolveOidcAal(-1)).toBeUndefined();
  });

  it('accepts canonical numeric strings', () => {
    expect(resolveOidcAal('2')).toBe(2);
    expect(resolveOidcAal(' 2 ')).toBe(2);
  });

  it('rejects non-canonical shapes as unknown', () => {
    expect(resolveOidcAal('2abc')).toBeUndefined();
    expect(resolveOidcAal('2.9')).toBeUndefined();
    expect(resolveOidcAal('-1')).toBeUndefined();
    expect(resolveOidcAal('+2')).toBeUndefined();
    expect(resolveOidcAal('')).toBeUndefined();
    expect(resolveOidcAal('   ')).toBeUndefined();
    expect(resolveOidcAal(undefined)).toBeUndefined();
    expect(resolveOidcAal(null)).toBeUndefined();
    expect(resolveOidcAal({ level: 2 })).toBeUndefined();
    expect(resolveOidcAal(['2'])).toBeUndefined();
  });
});
