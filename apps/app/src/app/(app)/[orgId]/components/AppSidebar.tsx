'use client';

import type { NavMessageKey } from '@/i18n/keys';
import { canAccessRoute, type UserPermissions } from '@/lib/permissions';
import type { Organization } from '@db';
import { AppShellNav, AppShellNavItem } from '@trycompai/design-system';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  id: string;
  path: string;
  nameKey: NavMessageKey;
  hidden?: boolean;
}

interface AppSidebarProps {
  organization: Organization;
  isQuestionnaireEnabled: boolean;
  hasAuditorRole: boolean;
  isOnlyAuditor: boolean;
  permissions: UserPermissions;
  /**
   * CS-189: Whether this user should see the Auditor View tab. Computed
   * server-side (see resolveAuditorViewAccess) because it needs to
   * distinguish owner/admin's implicit audit:read from a custom role's
   * explicit audit:read.
   */
  canAccessAuditorView: boolean;
}

export function AppSidebar({
  organization,
  isQuestionnaireEnabled,
  permissions,
  canAccessAuditorView,
}: AppSidebarProps) {
  const t = useTranslations('nav');
  const pathname = usePathname() ?? '';

  const navItems: NavItem[] = [
    {
      id: 'overview',
      path: `/${organization.id}/overview`,
      nameKey: 'overview',
      hidden: !canAccessRoute(permissions, 'overview'),
    },
    {
      id: 'frameworks',
      path: `/${organization.id}/frameworks`,
      nameKey: 'frameworks',
      hidden: !canAccessRoute(permissions, 'frameworks'),
    },
    {
      id: 'auditor',
      path: `/${organization.id}/auditor`,
      nameKey: 'auditorView',
      // CS-189: visibility is scoped to built-in `auditor` role or a custom
      // org role that explicitly grants audit:read. Owner/admin's implicit
      // permissions alone are not enough — see `canAccessAuditorView` in
      // lib/permissions.ts for the full rule.
      hidden: !canAccessAuditorView,
    },
    {
      id: 'policies',
      path: `/${organization.id}/policies`,
      nameKey: 'policies',
      hidden: !canAccessRoute(permissions, 'policies'),
    },
    {
      id: 'tasks',
      path: `/${organization.id}/tasks`,
      nameKey: 'evidence',
      hidden: !canAccessRoute(permissions, 'tasks'),
    },
    {
      id: 'documents',
      path: `/${organization.id}/documents`,
      nameKey: 'documents',
      hidden: !canAccessRoute(permissions, 'documents'),
    },
    {
      id: 'people',
      path: `/${organization.id}/people/all`,
      nameKey: 'people',
      hidden: !canAccessRoute(permissions, 'people'),
    },
    {
      id: 'risk',
      path: `/${organization.id}/risk`,
      nameKey: 'risks',
      hidden: !canAccessRoute(permissions, 'risk'),
    },
    {
      id: 'vendors',
      path: `/${organization.id}/vendors`,
      nameKey: 'vendors',
      hidden: !canAccessRoute(permissions, 'vendors'),
    },
    {
      id: 'questionnaire',
      path: `/${organization.id}/questionnaire`,
      nameKey: 'questionnaire',
      hidden: !isQuestionnaireEnabled || !canAccessRoute(permissions, 'questionnaire'),
    },
    {
      id: 'integrations',
      path: `/${organization.id}/integrations`,
      nameKey: 'integrations',
      hidden: !canAccessRoute(permissions, 'integrations'),
    },
    {
      id: 'tests',
      path: `/${organization.id}/cloud-tests`,
      nameKey: 'cloudTests',
      hidden: !canAccessRoute(permissions, 'cloud-tests'),
    },
  ];

  const isPathActive = (itemPath: string) => {
    const itemPathParts = itemPath.split('/').filter(Boolean);
    const itemBaseSegment = itemPathParts.length > 1 ? itemPathParts[1] : '';

    const currentPathParts = pathname.split('/').filter(Boolean);
    const currentBaseSegment = currentPathParts.length > 1 ? currentPathParts[1] : '';

    if (itemPath === `/${organization.id}` || itemPath === `/${organization.id}/implementation`) {
      return (
        pathname === `/${organization.id}` ||
        pathname?.startsWith(`/${organization.id}/implementation`)
      );
    }

    return itemBaseSegment === currentBaseSegment;
  };

  const visibleItems = navItems.filter((item) => !item.hidden);

  return (
    <AppShellNav>
      {visibleItems.map((item) => (
        <Link key={item.id} href={item.path}>
          <AppShellNavItem isActive={isPathActive(item.path)}>{t(item.nameKey)}</AppShellNavItem>
        </Link>
      ))}
    </AppShellNav>
  );
}
