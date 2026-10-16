import { describe, expect, it } from 'vitest';
import { canAccessRoute, getDefaultRoute } from './permissions';

describe('delegated role management routes', () => {
  it.each([['read'], ['read', 'create', 'update', 'delete']])(
    'allows settings and the roles list with ac permissions %j and no member access',
    (...actions) => {
      const permissions = { app: ['read'], ac: actions };
      expect(canAccessRoute(permissions, 'settings')).toBe(true);
      expect(canAccessRoute(permissions, 'settings/roles')).toBe(true);
      expect(canAccessRoute(permissions, 'settings/roles/:id')).toBe(true);
      expect(canAccessRoute(permissions, 'people')).toBe(false);
      expect(getDefaultRoute(permissions, 'org_1')).toBe('/org_1/settings');
    },
  );

  it('does not grant role access through member:read', () => {
    const permissions = { app: ['read'], member: ['read'] };
    expect(canAccessRoute(permissions, 'settings/roles')).toBe(false);
    expect(canAccessRoute(permissions, 'settings/roles/:id')).toBe(false);
    expect(canAccessRoute(permissions, 'settings/roles/new')).toBe(false);
  });

  it('keeps role creation restricted to writers', () => {
    expect(canAccessRoute({ ac: ['read'] }, 'settings/roles/new')).toBe(false);
    expect(canAccessRoute({ ac: ['read', 'create'] }, 'settings/roles/new')).toBe(true);
    expect(canAccessRoute({}, 'settings/roles')).toBe(false);
  });
});
