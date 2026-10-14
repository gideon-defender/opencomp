import {
  isJwtShaped,
  resolveGideonAal,
  resolveGideonTenantClaim,
} from './gideon-tenant-claim';

/**
 * Phase 0 tenant-claim contract (Gram auth cutover): the tenant resolves
 * from verified Gideon claims `tid` / `tenant_id` / `organizationId` /
 * `tenantId`. Missing, malformed or conflicting claims reject the token —
 * any alternative mapping needs an approved mapping contract.
 */
describe('resolveGideonTenantClaim (Phase 0 contract)', () => {
  it('resolves each accepted alias on its own', () => {
    expect(resolveGideonTenantClaim({ tid: 'org_1' })).toEqual({
      ok: true,
      tenantId: 'org_1',
    });
    expect(resolveGideonTenantClaim({ tenant_id: 'org_2' })).toEqual({
      ok: true,
      tenantId: 'org_2',
    });
    expect(resolveGideonTenantClaim({ organizationId: 'org_3' })).toEqual({
      ok: true,
      tenantId: 'org_3',
    });
    expect(resolveGideonTenantClaim({ tenantId: 'org_4' })).toEqual({
      ok: true,
      tenantId: 'org_4',
    });
  });

  it('rejects a missing tenant claim', () => {
    const result = resolveGideonTenantClaim({ sub: 'u' });
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
    const result = resolveGideonTenantClaim({ [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it.each([
    ['tid', 'tenant_id'],
    ['tid', 'organizationId'],
    ['tid', 'tenantId'],
    ['tenant_id', 'organizationId'],
  ])('rejects conflicting aliases (%s vs %s)', (first, second) => {
    const result = resolveGideonTenantClaim({
      [first]: 'org_a',
      [second]: 'org_b',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('conflict');
  });

  it('rejects conflicting claim aliases with distinct values', () => {
    const result = resolveGideonTenantClaim({
      tid: 'org_a',
      tenant_id: 'org_b',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('conflict');
  });

  it('accepts agreeing aliases and trims whitespace', () => {
    expect(
      resolveGideonTenantClaim({ tid: 'org_1', tenant_id: 'org_1' }),
    ).toEqual({ ok: true, tenantId: 'org_1' });
    expect(resolveGideonTenantClaim({ tid: '  org_1  ' })).toEqual({
      ok: true,
      tenantId: 'org_1',
    });
  });

  it('ignores null/undefined aliases when another alias resolves', () => {
    expect(resolveGideonTenantClaim({ tid: null, tenant_id: 'org_1' })).toEqual(
      { ok: true, tenantId: 'org_1' },
    );
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

describe('resolveGideonAal', () => {
  it('passes finite numbers through', () => {
    expect(resolveGideonAal(2)).toBe(2);
    expect(resolveGideonAal(0)).toBe(0);
    expect(resolveGideonAal(NaN)).toBeUndefined();
    expect(resolveGideonAal(Infinity)).toBeUndefined();
    expect(resolveGideonAal(-1)).toBeUndefined();
  });

  it('accepts canonical numeric strings', () => {
    expect(resolveGideonAal('2')).toBe(2);
    expect(resolveGideonAal(' 2 ')).toBe(2);
  });

  it('rejects non-canonical shapes as unknown', () => {
    expect(resolveGideonAal('2abc')).toBeUndefined();
    expect(resolveGideonAal('2.9')).toBeUndefined();
    expect(resolveGideonAal('-1')).toBeUndefined();
    expect(resolveGideonAal('+2')).toBeUndefined();
    expect(resolveGideonAal('')).toBeUndefined();
    expect(resolveGideonAal('   ')).toBeUndefined();
    expect(resolveGideonAal(undefined)).toBeUndefined();
    expect(resolveGideonAal(null)).toBeUndefined();
    expect(resolveGideonAal({ level: 2 })).toBeUndefined();
    expect(resolveGideonAal(['2'])).toBeUndefined();
  });
});
