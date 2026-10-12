'use client';
import {
  canAccessCompliance,
  canAccessRoute,
  hasAnyPermission,
  type UserPermissions,
} from '@/lib/permissions';
import {
  BadgeCheck as Badge,
  Globe,
  ShieldCheck as ManageProtection,
  Settings,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ShellRailNavItem } from './ShellRailNavItem';
export function AppShellProductNavigation({
  organizationId,
  permissions,
  isSettingsActive,
  isTrustActive,
  isSecurityActive,
  isSecurityEnabled,
  isOnlyAuditor,
}: {
  organizationId: string;
  permissions: UserPermissions;
  isSettingsActive: boolean;
  isTrustActive: boolean;
  isSecurityActive: boolean;
  isSecurityEnabled: boolean;
  isOnlyAuditor: boolean;
}) {
  const t = useTranslations('nav');
  return (
    <>
      {canAccessCompliance(permissions) && (
        <ShellRailNavItem
          href={`/${organizationId}/overview`}
          isActive={!isSettingsActive && !isTrustActive && !isSecurityActive}
          icon={<Badge className="size-5" />}
          label={t('compliance')}
        />
      )}
      {hasAnyPermission(permissions, [{ resource: 'trust', action: 'read' }]) && (
        <ShellRailNavItem
          href={`/${organizationId}/trust`}
          isActive={isTrustActive}
          icon={<Globe className="size-5" />}
          label={t('trust')}
        />
      )}
      {isSecurityEnabled && canAccessRoute(permissions, 'penetration-tests') ? (
        <ShellRailNavItem
          href={`/${organizationId}/security`}
          isActive={isSecurityActive}
          icon={<ManageProtection className="size-5" />}
          label={t('security')}
        />
      ) : null}
      {!isOnlyAuditor && canAccessRoute(permissions, 'settings') && (
        <ShellRailNavItem
          href={`/${organizationId}/settings`}
          isActive={isSettingsActive}
          icon={<Settings className="size-5" />}
          label={t('settings')}
        />
      )}
    </>
  );
}
