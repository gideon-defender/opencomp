import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePermissions } from './use-permissions';

const { activeMember } = vi.hoisted(() => ({
  activeMember: vi.fn(),
}));

vi.mock('@/utils/auth-client', () => ({ useActiveMember: activeMember }));
vi.mock('swr', () => ({ default: () => ({ data: undefined }) }));

describe('integration permissions from SSO membership roles', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['admin,owner', 'owner,admin', 'admin', 'owner'])(
    'grants integration management for %s before the permissions request completes',
    (role) => {
      activeMember.mockReturnValue({ data: { role, roleSource: 'sso' } });
      const { result } = renderHook(() => usePermissions());

      for (const action of ['read', 'create', 'update', 'delete']) {
        expect(result.current.hasPermission('integration', action)).toBe(true);
      }
    },
  );

  it('keeps auditor integration access read-only', () => {
    activeMember.mockReturnValue({ data: { role: 'auditor', roleSource: 'sso' } });
    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('integration', 'read')).toBe(true);
    for (const action of ['create', 'update', 'delete']) {
      expect(result.current.hasPermission('integration', action)).toBe(false);
    }
  });

  it('grants no integration access without an active member', () => {
    activeMember.mockReturnValue({ data: null });
    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('integration', 'read')).toBe(false);
    expect(result.current.hasPermission('integration', 'create')).toBe(false);
  });
});
