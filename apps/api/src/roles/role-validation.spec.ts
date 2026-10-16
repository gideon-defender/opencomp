import {
  hasCaseOnlyCollision,
  validateRoleName,
  validateRoleObligations,
  validateRolePermissions,
} from './role-validation';

describe('role-validation (case-sensitive exact-match)', () => {
  it('accepts mixed-case custom names (exact-match, like built-ins are exact)', () => {
    expect(validateRoleName('Compliance Lead')).toBe('Compliance Lead');
  });

  it('trims but preserves case', () => {
    expect(validateRoleName('  Lead  ')).toBe('Lead');
  });

  it('rejects built-in names exact and case-insensitive', () => {
    expect(() => validateRoleName('admin')).toThrow(
      'is a built-in role and cannot be used',
    );
    expect(() => validateRoleName('Admin')).toThrow(
      'is a built-in role and cannot be used',
    );
    expect(() => validateRoleName('OWNER')).toThrow(
      'is a built-in role and cannot be used',
    );
  });

  it('rejects short, long, and badly shaped names', () => {
    expect(() => validateRoleName('A')).toThrow('2-50 characters');
    expect(() => validateRoleName('1Lead')).toThrow('start with a letter');
    expect(() => validateRoleName('Lead!')).toThrow('start with a letter');
  });

  it('rejects control characters in names (only literal spaces allowed)', () => {
    for (const name of ['AB\nCD', 'A\rB', 'A\tB', 'Lead\fX', 'Lead\vX']) {
      expect(() => validateRoleName(name)).toThrow(
        'only letters, numbers, spaces, and hyphens',
      );
    }
    expect(validateRoleName('Compliance Lead')).toBe('Compliance Lead');
    expect(validateRoleName('Lead-2')).toBe('Lead-2');
  });

  it('dedupes repeated actions', () => {
    expect(validateRolePermissions({ control: ['read', 'read'] })).toEqual({
      control: ['read'],
    });
  });

  it('detects case-only collisions', () => {
    expect(hasCaseOnlyCollision('Lead', ['lead'])).toBe(true);
    expect(hasCaseOnlyCollision('Lead', ['Lead'])).toBe(false);
    expect(hasCaseOnlyCollision('Lead', ['Other'])).toBe(false);
  });

  it('accepts a valid permission map', () => {
    expect(validateRolePermissions({ control: ['read'] })).toEqual({
      control: ['read'],
    });
  });

  it('rejects empty, unknown resource, and invalid action', () => {
    expect(() => validateRolePermissions({})).toThrow(
      'At least one permission must be granted',
    );
    expect(() => validateRolePermissions({ nope: ['read'] })).toThrow(
      'Unknown resource',
    );
    expect(() => validateRolePermissions({ control: ['explode'] })).toThrow(
      'Invalid action',
    );
  });

  it('rejects prototype-chain resources as unknown (400, not 500)', () => {
    for (const resource of ['__proto__', 'constructor', 'prototype']) {
      expect(() => validateRolePermissions({ [resource]: ['read'] })).toThrow(
        'Unknown resource',
      );
    }
  });

  it('allows ac:* (audited delegation, per decision)', () => {
    expect(validateRolePermissions({ ac: ['create'] })).toEqual({
      ac: ['create'],
    });
  });

  it('defaults obligations to {} and rejects unknown keys', () => {
    expect(validateRoleObligations(undefined)).toEqual({});
    expect(validateRoleObligations({ compliance: true })).toEqual({
      compliance: true,
    });
    expect(() => validateRoleObligations({ other: true })).toThrow(
      'Unknown obligation',
    );
  });

  it('rejects non-string names and non-object permissions', () => {
    expect(() => validateRoleName(123)).toThrow('must be a string');
    expect(() => validateRolePermissions(null)).toThrow('non-empty object');
    expect(() => validateRolePermissions([])).toThrow('non-empty object');
    expect(() => validateRolePermissions({ control: [] })).toThrow(
      'at least one action',
    );
  });

  it('rejects non-object obligations and non-boolean flags', () => {
    expect(() => validateRoleObligations(null)).toThrow('must be an object');
    expect(() => validateRoleObligations([])).toThrow('must be an object');
    expect(() => validateRoleObligations({ compliance: 'yes' })).toThrow(
      'must be a boolean',
    );
  });
});
