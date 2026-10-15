'use client';

import { updateSidebarState } from '@/actions/sidebar';
import Chat from '@/components/ai/chat';
import { CheckoutCompleteDialog } from '@/components/dialogs/checkout-complete-dialog';
import { LanguageSwitcher } from '@/components/language-switcher';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { OrganizationBadge } from '@/components/organization-badge';
import { SidebarProvider, useSidebar } from '@/context/sidebar-context';
import type { UserPermissions } from '@/lib/permissions';
import { signOutFromOidc } from '@/utils/oidc-sign-out';
import type { Onboarding, Organization } from '@db';
import { Avatar, AvatarFallback, AvatarImage } from '@gideon-defender/ui/avatar';
import { BrandLogo } from '@gideon-defender/ui/brand-logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gideon-defender/ui/dropdown-menu';
import {
  AppShell,
  AppShellAIChatTrigger,
  AppShellBody,
  AppShellContent,
  AppShellMain,
  AppShellNavbar,
  AppShellRail,
  AppShellSidebar,
  AppShellSidebarHeader,
  AppShellUserMenu,
  CommandSearch,
  ThemeSwitcher,
  TooltipProvider,
} from '@trycompai/design-system';
import { LogOut as Logout, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAction } from 'next-safe-action/hooks';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useCallback, useRef } from 'react';
import { SecuritySidebar } from '../security/components/SecuritySidebar';
import { SettingsSidebar } from '../settings/components/SettingsSidebar';
import { TrustSidebar } from '../trust/components/TrustSidebar';
import { getAppShellSearchGroups } from './app-shell-search-groups';
import { AppShellProductNavigation } from './AppShellProductNavigation';
import { AppSidebar } from './AppSidebar';
import { ConditionalOnboardingTracker } from './ConditionalOnboardingTracker';

interface AppShellWrapperProps {
  children: React.ReactNode;
  organization: Organization;
  logoUrl?: string;
  onboarding: Onboarding | null;
  isCollapsed: boolean;
  isQuestionnaireEnabled: boolean;
  isWebAutomationsEnabled: boolean;
  isSecurityEnabled: boolean;
  hasAuditorRole: boolean;
  isOnlyAuditor: boolean;
  /** CS-189: server-resolved Auditor View visibility — see resolveAuditorViewAccess. */
  canAccessAuditorView: boolean;
  permissions: UserPermissions;
  user: {
    name: string | null;
    email: string;
    image: string | null;
  };
}

type AppShellWrapperContentProps = Omit<AppShellWrapperProps, 'isCollapsed'>;

export function AppShellWrapper({ isCollapsed, ...props }: AppShellWrapperProps) {
  return (
    <SidebarProvider initialIsCollapsed={isCollapsed}>
      <AppShellWrapperContent {...props} />
    </SidebarProvider>
  );
}

function AppShellWrapperContent({
  children,
  organization,
  logoUrl,
  onboarding,
  isQuestionnaireEnabled,
  isWebAutomationsEnabled,
  isSecurityEnabled,
  hasAuditorRole,
  isOnlyAuditor,
  canAccessAuditorView,
  permissions,
  user,
}: AppShellWrapperContentProps) {
  const t = useTranslations('nav');
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const { isCollapsed, setIsCollapsed } = useSidebar();
  const previousIsCollapsedRef = useRef(isCollapsed);
  const isSettingsActive = pathname?.startsWith(`/${organization.id}/settings`);
  const isTrustActive = pathname?.startsWith(`/${organization.id}/trust`);
  const isSecurityActive = pathname?.startsWith(`/${organization.id}/security`);

  const { execute } = useAction(updateSidebarState, {
    onError: () => {
      setIsCollapsed(previousIsCollapsedRef.current);
    },
  });

  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      const nextIsCollapsed = !open;
      previousIsCollapsedRef.current = isCollapsed;
      setIsCollapsed(nextIsCollapsed);
      execute({ isCollapsed: nextIsCollapsed });
    },
    [execute, isCollapsed, setIsCollapsed],
  );

  const searchGroups = getAppShellSearchGroups({
    t,
    organizationId: organization.id,
    router,
    permissions,
    hasAuditorRole,
    isOnlyAuditor,
    canAccessAuditorView,
    isQuestionnaireEnabled,
    isSecurityEnabled,
    isAdvancedModeEnabled: organization.advancedModeEnabled,
  });

  return (
    <TooltipProvider>
      <AppShell
        showAIChat
        aiChatContent={<Chat />}
        sidebarOpen={!isCollapsed}
        onSidebarOpenChange={handleSidebarOpenChange}
      >
        <AppShellNavbar
          startContent={
            <div className="flex items-center gap-1">
              <Link href="/">
                <BrandLogo showText iconSize={22} />
              </Link>
              <span className="pl-3 pr-1 text-muted-foreground">/</span>
              <OrganizationBadge organization={organization} logoUrl={logoUrl} />
            </div>
          }
          centerContent={<CommandSearch groups={searchGroups} placeholder={t('search')} />}
          endContent={
            <AppShellUserMenu>
              <AppShellAIChatTrigger />
              <NotificationBell />
              <DropdownMenu>
                <DropdownMenuTrigger
                  id="app-shell-user-menu-trigger"
                  className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-muted"
                >
                  <Avatar>
                    {user.image && <AvatarImage src={user.image} />}
                    <AvatarFallback>
                      {user.name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  id="app-shell-user-menu-content"
                  align="end"
                  style={{ minWidth: '200px' }}
                >
                  <div className="px-2 py-1.5">
                    <span className="text-sm font-medium">{user.name}</span>
                    <span className="text-xs text-muted-foreground">{user.email}</span>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <Link href={`/${organization.id}/settings`}>
                      <DropdownMenuItem>
                        <Settings size={16} />
                        {t('settings')}
                      </DropdownMenuItem>
                    </Link>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-sm">{t('theme')}</span>
                    <ThemeSwitcher
                      size="sm"
                      value={(theme ?? 'system') as 'light' | 'dark' | 'system'}
                      defaultValue="system"
                      onChange={(value) => setTheme(value)}
                      showSystem
                    />
                  </div>
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-sm">{t('language')}</span>
                    <LanguageSwitcher />
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={async () => {
                      await signOutFromOidc();
                    }}
                  >
                    <Logout size={16} />
                    {t('logOut')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </AppShellUserMenu>
          }
        />
        <AppShellBody>
          <AppShellRail>
            <AppShellProductNavigation
              organizationId={organization.id}
              permissions={permissions}
              isSettingsActive={isSettingsActive}
              isTrustActive={isTrustActive}
              isSecurityActive={isSecurityActive}
              isSecurityEnabled={isSecurityEnabled}
              isOnlyAuditor={isOnlyAuditor}
            />
          </AppShellRail>
          <AppShellMain>
            <AppShellSidebar collapsible>
              <AppShellSidebarHeader
                title={
                  isSettingsActive
                    ? t('settings')
                    : isTrustActive
                      ? t('trust')
                      : isSecurityActive
                        ? t('security')
                        : t('compliance')
                }
              />
              {isSettingsActive ? (
                <SettingsSidebar
                  orgId={organization.id}
                  showBrowserTab={isWebAutomationsEnabled}
                  showBillingTab={isSecurityEnabled}
                />
              ) : isTrustActive ? (
                <TrustSidebar orgId={organization.id} />
              ) : isSecurityActive && isSecurityEnabled ? (
                <SecuritySidebar orgId={organization.id} />
              ) : (
                <AppSidebar
                  organization={organization}
                  isQuestionnaireEnabled={isQuestionnaireEnabled}
                  hasAuditorRole={hasAuditorRole}
                  isOnlyAuditor={isOnlyAuditor}
                  permissions={permissions}
                  canAccessAuditorView={canAccessAuditorView}
                />
              )}
            </AppShellSidebar>

            <AppShellContent>
              {onboarding?.triggerJobId && <ConditionalOnboardingTracker onboarding={onboarding} />}
              {children}
            </AppShellContent>
          </AppShellMain>

          <Suspense fallback={null}>
            <CheckoutCompleteDialog orgId={organization.id} />
          </Suspense>
        </AppShellBody>
      </AppShell>
    </TooltipProvider>
  );
}
