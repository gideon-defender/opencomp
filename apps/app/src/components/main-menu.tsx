'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { canAccessRoute } from '@/lib/permissions';
import { Badge } from '@gideon-defender/ui/badge';
import { Button } from '@gideon-defender/ui/button';
import { cn } from '@gideon-defender/ui/cn';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@gideon-defender/ui/tooltip';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getMainMenuItems, type MenuItem } from './main-menu-items';

// Define menu item types with icon component
interface ItemProps {
  organizationId?: string;
  item: MenuItem;
  isActive: boolean;
  disabled: boolean;
  isCollapsed?: boolean;
  onItemClick?: () => void;
  itemRef: (el: HTMLDivElement | null) => void;
}

type Props = {
  organizationId?: string;
  organization?: { advancedModeEnabled?: boolean } | null;
  isCollapsed?: boolean;
  onItemClick?: () => void;
  isQuestionnaireEnabled?: boolean;
  isOnlyAuditor?: boolean;
};

export function MainMenu({
  organizationId,
  organization,
  isCollapsed = false,
  onItemClick,
  isQuestionnaireEnabled = false,
  isOnlyAuditor = false,
}: Props) {
  const pathname = usePathname();
  const [activeStyle, setActiveStyle] = useState({ top: '0px', height: '0px' });
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  // CS-189: Auditor View visibility is scoped to the built-in `auditor`
  // role or a custom org role that explicitly grants audit:read — NOT to
  // owner/admin's implicit all-permissions. See `canAccessAuditorView` in
  // lib/permissions.ts for the full rule.
  const { canAccessAuditorView, permissions } = usePermissions();

  const items = getMainMenuItems({
    canAccessAuditorView,
    isAdvancedModeEnabled: organization?.advancedModeEnabled ?? false,
    isQuestionnaireEnabled,
    isOnlyAuditor,
  });

  // Helper function to check if a path is active
  const isPathActive = (itemPath: string) => {
    const normalizedItemPath = itemPath.replace(':organizationId', organizationId ?? '');

    // Extract the base path from the menu item (first two segments after normalization)
    const itemPathParts = normalizedItemPath.split('/').filter(Boolean);
    const itemBaseSegment = itemPathParts.length > 1 ? itemPathParts[1] : '';

    // Extract the current path parts
    const currentPathParts = pathname.split('/').filter(Boolean);
    const currentBaseSegment = currentPathParts.length > 1 ? currentPathParts[1] : '';

    // Special case for root organization path
    if (
      normalizedItemPath === `/${organizationId}` ||
      normalizedItemPath === `/${organizationId}/implementation`
    ) {
      return (
        pathname === `/${organizationId}` ||
        pathname?.startsWith(`/${organizationId}/implementation`)
      );
    }

    return itemBaseSegment === currentBaseSegment;
  };

  const visibleItems = items.filter(
    (item) =>
      !item.disabled && !item.hidden && canAccessRoute(permissions, item.path.split('/')[2]),
  );
  const activeIndex = visibleItems.findIndex((item) => isPathActive(item.path));

  // Update active indicator position
  useEffect(() => {
    if (activeIndex >= 0) {
      const activeElement = itemRefs.current[activeIndex];
      if (activeElement) {
        const { offsetTop, offsetHeight } = activeElement;
        setActiveStyle({
          top: `${offsetTop}px`,
          height: `${offsetHeight}px`,
        });
      }
    }
  }, [activeIndex, pathname]);

  // Handle window resize to recalculate positions
  useEffect(() => {
    const handleResize = () => {
      if (activeIndex >= 0) {
        requestAnimationFrame(() => {
          const activeElement = itemRefs.current[activeIndex];
          if (activeElement) {
            const { offsetTop, offsetHeight } = activeElement;
            setActiveStyle({
              top: `${offsetTop}px`,
              height: `${offsetHeight}px`,
            });
          }
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeIndex]);

  return (
    <nav className="relative space-y-1">
      {/* Active Indicator */}
      <div
        className="bg-primary absolute -right-4 w-0.5 rounded-l-xs transition-all duration-300 ease-out"
        style={activeStyle}
      />

      {visibleItems.map((item, index) => {
        const isActive = isPathActive(item.path);
        return (
          <Item
            key={item.id}
            organizationId={organizationId ?? ''}
            item={item}
            isActive={isActive}
            disabled={item.disabled}
            isCollapsed={isCollapsed}
            onItemClick={onItemClick}
            itemRef={(el) => {
              itemRefs.current[index] = el;
            }}
          />
        );
      })}
    </nav>
  );
}

const Item = ({
  organizationId,
  item,
  isActive,
  disabled,
  isCollapsed = false,
  onItemClick,
  itemRef,
}: ItemProps) => {
  const t = useTranslations('nav');
  const Icon = item.icon;
  const linkDisabled = disabled || item.disabled;
  const itemPath = item.path.replace(':organizationId', organizationId ?? '');

  if (linkDisabled) {
    return (
      <div ref={itemRef}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size={isCollapsed ? 'icon' : 'default'}
                className={cn(
                  'w-full cursor-not-allowed opacity-50',
                  isCollapsed ? 'justify-center' : 'justify-start',
                )}
                disabled
              >
                {isCollapsed && <Icon size={16} />}
                {!isCollapsed && <span className="truncate">{t('comingSoon')}</span>}
              </Button>
            </TooltipTrigger>
            {isCollapsed && <TooltipContent side="right">{t('comingSoon')}</TooltipContent>}
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  return (
    <div ref={itemRef}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={isActive ? 'secondary' : 'ghost'}
              size={isCollapsed ? 'icon' : 'default'}
              className={cn('w-full', isCollapsed ? 'justify-center' : 'justify-start')}
              asChild
            >
              <Link href={itemPath} onClick={onItemClick}>
                {isCollapsed && <Icon size={16} />}
                {!isCollapsed && (
                  <>
                    <span className="flex-1 truncate text-left">{t(item.nameKey)}</span>
                    {item.badge && (
                      <Badge variant={item.badge.variant} className="ml-auto text-xs">
                        {item.badge.text}
                      </Badge>
                    )}
                  </>
                )}
              </Link>
            </Button>
          </TooltipTrigger>
          {isCollapsed && (
            <TooltipContent side="right" sideOffset={8}>
              <div className="flex items-center gap-2">
                {t(item.nameKey)}
                {item.badge && (
                  <Badge variant={item.badge.variant} className="text-xs">
                    {item.badge.text}
                  </Badge>
                )}
              </div>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};
