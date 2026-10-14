'use client';

import { Button } from '@gideon-defender/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@gideon-defender/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gideon-defender/ui/tabs';
import { PageHeader, PageLayout } from '@trycompai/design-system';
import { Download, MoreVertical, Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { StartBackgroundCheckDialog } from '../all/components/StartBackgroundCheckDialog';

interface PeoplePageTabsProps {
  peopleContent: ReactNode;
  employeeTasksContent: ReactNode | null;
  devicesContent: ReactNode;
  orgChartContent: ReactNode;
  findingsContent?: ReactNode | null;
  roleMappingContent: ReactNode | null;
  showRoleMapping: boolean;
  showEmployeeTasks: boolean;
  settingsContent: ReactNode | null;
  showSettings: boolean;
  canInviteUsers: boolean;
  canManageMembers: boolean;
  canStartScreening: boolean;
  candidatesContent: ReactNode | null;
  organizationId: string;
}

/** ?tab= value → Radix tab value */
function tabParamToInternal(
  tabParam: string | null,
  showEmployeeTasks: boolean,
  showRoleMapping: boolean,
  showSettings: boolean,
  showCandidates: boolean,
): string {
  if (!tabParam || tabParam === 'people') {
    return 'people';
  }
  if (tabParam === 'candidates') return showCandidates ? 'candidates' : 'people';
  if (tabParam === 'tasks') {
    return showEmployeeTasks ? 'employee-tasks' : 'people';
  }
  if (tabParam === 'devices') {
    return 'devices';
  }
  if (tabParam === 'chart') {
    return 'org-chart';
  }
  if (tabParam === 'role-mapping') {
    return showRoleMapping ? 'role-mapping' : 'people';
  }
  if (tabParam === 'settings') {
    return showSettings ? 'settings' : 'people';
  }
  return 'people';
}

/** Radix tab value → ?tab= query param */
function internalValueToTabParam(value: string): string {
  switch (value) {
    case 'employee-tasks':
      return 'tasks';
    case 'org-chart':
      return 'chart';
    case 'candidates':
    case 'people':
    case 'devices':
    case 'role-mapping':
    case 'settings':
      return value;
    default:
      return 'people';
  }
}

export function PeoplePageTabs({
  peopleContent,
  employeeTasksContent,
  devicesContent,
  orgChartContent,
  roleMappingContent,
  showRoleMapping,
  showEmployeeTasks,
  settingsContent,
  showSettings,
  canStartScreening,
  candidatesContent,
  organizationId,
}: PeoplePageTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isScreeningModalOpen, setIsScreeningModalOpen] = useState(false);

  const activeTab = tabParamToInternal(
    searchParams.get('tab'),
    showEmployeeTasks,
    showRoleMapping,
    showSettings,
    candidatesContent !== null,
  );

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const tabParam = internalValueToTabParam(value);
      if (tabParam === 'people') {
        params.delete('tab');
      } else {
        params.set('tab', tabParam);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <PageLayout
        header={
          <PageHeader
            title="People"
            tabs={
              <TabsList className="max-w-full overflow-x-auto">
                <TabsTrigger value="people">People</TabsTrigger>
                {candidatesContent && <TabsTrigger value="candidates">Candidates</TabsTrigger>}
                {showEmployeeTasks && <TabsTrigger value="employee-tasks">Tasks</TabsTrigger>}
                <TabsTrigger value="devices">Devices</TabsTrigger>
                <TabsTrigger value="org-chart">Chart</TabsTrigger>
                {showRoleMapping && <TabsTrigger value="role-mapping">Role Mapping</TabsTrigger>}
                {showSettings && <TabsTrigger value="settings">Settings</TabsTrigger>}
              </TabsList>
            }
            actions={
              <div className="flex items-center gap-2">
                <div>
                  <Button
                    onClick={() => setIsScreeningModalOpen(true)}
                    disabled={!canStartScreening}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Start background check
                  </Button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="People actions">
                      <MoreVertical size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        window.open(
                          '/api/offboarding-export?all=true',
                          '_blank',
                          'noopener,noreferrer',
                        );
                      }}
                    >
                      <Download size={14} className="mr-2" />
                      Export offboarding
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            }
          />
        }
      >
        <TabsContent value="people">{peopleContent}</TabsContent>
        {candidatesContent && <TabsContent value="candidates">{candidatesContent}</TabsContent>}
        {showEmployeeTasks && (
          <TabsContent value="employee-tasks">{employeeTasksContent}</TabsContent>
        )}
        <TabsContent value="devices">{devicesContent}</TabsContent>
        <TabsContent value="org-chart">{orgChartContent}</TabsContent>
        {showRoleMapping && <TabsContent value="role-mapping">{roleMappingContent}</TabsContent>}
        {showSettings && <TabsContent value="settings">{settingsContent}</TabsContent>}
      </PageLayout>

      <StartBackgroundCheckDialog
        key={organizationId}
        open={isScreeningModalOpen}
        onOpenChange={setIsScreeningModalOpen}
        organizationId={organizationId}
        canStart={canStartScreening}
      />
    </Tabs>
  );
}
