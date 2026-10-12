import { resolveBuiltInPermissions } from '@/lib/permissions';
import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShellProductNavigation } from './AppShellProductNavigation';
import { getAppShellSearchGroups } from './app-shell-search-groups';

mockNextIntl();
vi.mock('./ShellRailNavItem', () => ({
  ShellRailNavItem: ({ href, label }: { href: string; label: string }) => (
    <a href={href}>{label}</a>
  ),
}));

describe('Trust navigation without PostHog configuration', () => {
  it.each(['admin,owner', 'admin', 'auditor', 'employee'])(
    'retains permission gates for %s in the rail and search',
    (role) => {
      const { permissions } = resolveBuiltInPermissions(role);
      const canReadTrust = permissions.trust?.includes('read') ?? false;
      render(
        <AppShellProductNavigation
          organizationId="org_test"
          permissions={permissions}
          isSettingsActive={false}
          isTrustActive={false}
          isSecurityActive={false}
          isSecurityEnabled={false}
          isOnlyAuditor={role === 'auditor'}
        />,
      );
      expect(!!screen.queryByRole('link', { name: 'trust' })).toBe(canReadTrust);
      if (canReadTrust) {
        expect(screen.getByRole('link', { name: 'trust' })).toHaveAttribute(
          'href',
          '/org_test/trust',
        );
      }

      const groups = getAppShellSearchGroups({
        t: (key) => key,
        organizationId: 'org_test',
        router: { push: vi.fn() },
        permissions,
        hasAuditorRole: role === 'auditor',
        isOnlyAuditor: role === 'auditor',
        canAccessAuditorView: role === 'auditor',
        isQuestionnaireEnabled: false,
        isSecurityEnabled: false,
        isAdvancedModeEnabled: false,
      });
      expect(groups.flatMap((group) => group.items).some((item) => item.id === 'trust')).toBe(
        canReadTrust,
      );
    },
  );
});
