import { resolveBuiltInPermissions } from '@/lib/permissions';
import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MainMenu } from './main-menu';

mockNextIntl();
const { mockUsePermissions } = vi.hoisted(() => ({ mockUsePermissions: vi.fn() }));
vi.mock('@/hooks/use-permissions', () => ({ usePermissions: mockUsePermissions }));

describe('legacy and mobile Trust navigation', () => {
  it.each(['admin,owner', 'auditor', 'employee'])(
    'shows Trust according to %s permissions without a flag prop',
    (role) => {
      const { permissions } = resolveBuiltInPermissions(role);
      mockUsePermissions.mockReturnValue({ permissions, canAccessAuditorView: role === 'auditor' });
      render(<MainMenu organizationId="org_test" />);
      expect(!!screen.queryByRole('link', { name: 'trust' })).toBe(
        permissions.trust?.includes('read') ?? false,
      );
    },
  );
});
