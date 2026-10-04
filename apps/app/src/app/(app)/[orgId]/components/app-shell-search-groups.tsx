import type { NavMessageKey } from '@/i18n/keys';
import { canAccessRoute, type UserPermissions } from '@/lib/permissions';
import {
  Catalog,
  Chemistry,
  Dashboard,
  Document,
  Group,
  Integration,
  ListChecked,
  Policy,
  Security,
  Settings,
  ShoppingBag,
  Task,
  TaskComplete,
  Warning,
} from '@carbon/icons-react';
import type { CommandSearchGroup } from '@trycompai/design-system';
import type { ReactNode } from 'react';

interface AppShellSearchGroupsParams {
  t: (key: NavMessageKey) => string;
  organizationId: string;
  router: {
    push: (href: string) => void;
  };
  permissions: UserPermissions;
  hasAuditorRole: boolean;
  isOnlyAuditor: boolean;
  /** CS-189: resolved server-side — see AppShellWrapper. */
  canAccessAuditorView: boolean;
  isQuestionnaireEnabled: boolean;
  isTrustNdaEnabled: boolean;
  isSecurityEnabled: boolean;
  isAdvancedModeEnabled: boolean;
}

interface NavigationItemParams {
  id: string;
  label: string;
  icon: ReactNode;
  path: string;
  keywords: string[];
  router: {
    push: (href: string) => void;
  };
}

const createNavItem = ({
  id,
  label,
  icon,
  path,
  keywords,
  router,
}: NavigationItemParams): CommandSearchGroup['items'][number] => ({
  id,
  label,
  icon,
  keywords,
  onSelect: () => router.push(path),
});

export const getAppShellSearchGroups = ({
  t,
  organizationId,
  router,
  permissions,
  isOnlyAuditor,
  canAccessAuditorView,
  isQuestionnaireEnabled,
  isTrustNdaEnabled,
  isSecurityEnabled,
}: AppShellSearchGroupsParams): CommandSearchGroup[] => {
  const can = (route: string) => canAccessRoute(permissions, route);

  const baseItems = [
    ...(can('overview')
      ? [
          createNavItem({
            id: 'overview',
            label: t('overview'),
            icon: <Dashboard size={16} />,
            path: `/${organizationId}/overview`,
            keywords: ['dashboard', 'home', 'overview'],
            router,
          }),
        ]
      : []),
    ...(can('frameworks')
      ? [
          createNavItem({
            id: 'frameworks',
            label: t('frameworks'),
            icon: <Security size={16} />,
            path: `/${organizationId}/frameworks`,
            keywords: ['frameworks', 'compliance', 'standards'],
            router,
          }),
        ]
      : []),
    // CS-189: gate on the server-resolved canAccessAuditorView flag so
    // owner/admin are hidden unless they explicitly opt in via a custom role.
    ...(canAccessAuditorView
      ? [
          createNavItem({
            id: 'auditor',
            label: t('auditorView'),
            icon: <TaskComplete size={16} />,
            path: `/${organizationId}/auditor`,
            keywords: ['audit', 'review'],
            router,
          }),
        ]
      : []),
    ...(can('policies')
      ? [
          createNavItem({
            id: 'policies',
            label: t('policies'),
            icon: <Policy size={16} />,
            path: `/${organizationId}/policies`,
            keywords: ['policy', 'documents'],
            router,
          }),
        ]
      : []),
    ...(can('tasks')
      ? [
          createNavItem({
            id: 'evidence',
            label: t('evidence'),
            icon: <ListChecked size={16} />,
            path: `/${organizationId}/tasks`,
            keywords: ['tasks', 'evidence', 'artifacts'],
            router,
          }),
        ]
      : []),
    ...(isTrustNdaEnabled && can('trust')
      ? [
          createNavItem({
            id: 'trust',
            label: t('trust'),
            icon: <Task size={16} />,
            path: `/${organizationId}/trust`,
            keywords: ['trust center', 'portal'],
            router,
          }),
        ]
      : []),
    ...(isSecurityEnabled && can('penetration-tests')
      ? [
          createNavItem({
            id: 'security',
            label: t('security'),
            icon: <Security size={16} />,
            path: `/${organizationId}/security`,
            keywords: ['security', 'vulnerability', 'reports'],
            router,
          }),
        ]
      : []),
    ...(can('documents')
      ? [
          createNavItem({
            id: 'documents',
            label: t('documents'),
            icon: <Catalog size={16} />,
            path: `/${organizationId}/documents`,
            keywords: ['company', 'tasks', 'forms', 'evidence submissions', 'documents'],
            router,
          }),
        ]
      : []),
    ...(can('people')
      ? [
          createNavItem({
            id: 'people',
            label: t('people'),
            icon: <Group size={16} />,
            path: `/${organizationId}/people/all`,
            keywords: ['users', 'team', 'members', 'employees'],
            router,
          }),
        ]
      : []),
    ...(can('risk')
      ? [
          createNavItem({
            id: 'risks',
            label: t('risks'),
            icon: <Warning size={16} />,
            path: `/${organizationId}/risk`,
            keywords: ['risk management', 'assessment'],
            router,
          }),
        ]
      : []),
    ...(can('vendors')
      ? [
          createNavItem({
            id: 'vendors',
            label: t('vendors'),
            icon: <ShoppingBag size={16} />,
            path: `/${organizationId}/vendors`,
            keywords: ['suppliers', 'third party'],
            router,
          }),
        ]
      : []),
    ...(isQuestionnaireEnabled && can('questionnaire')
      ? [
          createNavItem({
            id: 'questionnaire',
            label: t('questionnaire'),
            icon: <Document size={16} />,
            path: `/${organizationId}/questionnaire`,
            keywords: ['survey', 'questions'],
            router,
          }),
        ]
      : []),
    ...(!isOnlyAuditor && can('integrations')
      ? [
          createNavItem({
            id: 'integrations',
            label: t('integrations'),
            icon: <Integration size={16} />,
            path: `/${organizationId}/integrations`,
            keywords: ['connect', 'apps', 'services'],
            router,
          }),
        ]
      : []),
    ...(can('cloud-tests')
      ? [
          createNavItem({
            id: 'cloud-tests',
            label: t('cloudTests'),
            icon: <Chemistry size={16} />,
            path: `/${organizationId}/cloud-tests`,
            keywords: ['testing', 'cloud', 'infrastructure'],
            router,
          }),
        ]
      : []),
  ];

  return [
    ...(baseItems.length > 0
      ? [
          {
            id: 'navigation',
            label: t('navigation'),
            items: baseItems,
          },
        ]
      : []),
    ...(!isOnlyAuditor && can('settings')
      ? [
          {
            id: 'settings',
            label: t('settings'),
            items: [
              createNavItem({
                id: 'settings-general',
                label: t('generalSettings'),
                icon: <Settings size={16} />,
                path: `/${organizationId}/settings`,
                keywords: ['preferences', 'configuration'],
                router,
              }),
            ],
          },
        ]
      : []),
  ];
};
