'use client';

import { UpdateOrganizationEvidenceApproval } from '@/components/forms/organization/update-organization-evidence-approval';
import { usePermissions } from '@/hooks/use-permissions';
import { triggerBulkEvidenceExport } from '@/lib/evidence-download';
import type { Member, Task, User } from '@db';
import { useRealtimeRun } from '@gideon-defender/trigger-react';
import {
  Button,
  PageHeader,
  PageLayout,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@trycompai/design-system';
import { Add, ArrowDown } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTasks } from '../hooks/useTasks';
import type { FrameworkInstanceForTasks } from '../types';
import { CreateTaskSheet } from './CreateTaskSheet';
import { TaskList } from './TaskList';

interface TasksPageClientProps {
  tasks: (Task & {
    controls: { id: string; name: string }[];
    evidenceAutomations?: Array<{
      id: string;
      isEnabled: boolean;
      name: string;
      runs?: Array<{
        status: string;
        success: boolean | null;
        evaluationStatus: string | null;
        createdAt: Date;
        triggeredBy: string;
        runDuration: number | null;
      }>;
    }>;
  })[];
  members: (Member & { user: User })[];
  controls: { id: string; name: string }[];
  frameworkInstances: FrameworkInstanceForTasks[];
  activeTab: 'categories' | 'list';
  orgId: string;
  organizationName: string | null;
  hasEvidenceExportAccess: boolean;
  evidenceApprovalEnabled: boolean;
}

export function TasksPageClient({
  tasks: initialTasks,
  members,
  controls,
  frameworkInstances,
  activeTab,
  organizationName,
  hasEvidenceExportAccess,
  evidenceApprovalEnabled,
}: TasksPageClientProps) {
  const { tasks, createTask } = useTasks({ initialData: initialTasks });
  const { hasPermission } = usePermissions();
  const t = useTranslations('tasks');
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
  const [includeRawJson, setIncludeRawJson] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [mainTab, setMainTab] = useState('evidence-list');
  const [exportRun, setExportRun] = useState<{
    runId: string;
    accessToken: string;
  } | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);

  // Subscribe for the onComplete side effect (download / error toast); the
  // returned run isn't rendered here, so we don't destructure it.
  useRealtimeRun(exportRun?.runId ?? '', {
    accessToken: exportRun?.accessToken,
    enabled: !!exportRun,
    onComplete: (run, err) => {
      // useRealtimeRun fires onComplete on any terminal state (and surfaces
      // subscription errors via `err`), so treat anything that isn't a clean
      // COMPLETED run as a failure.
      if (err || run.status !== 'COMPLETED') {
        toast.error(t('page.exportFailed'));
        setExportRun(null);
        return;
      }
      const downloadUrl =
        run.output?.downloadUrl ?? (run.metadata?.downloadUrl as string | undefined);
      if (downloadUrl) {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${organizationName || 'evidence'}-export.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success(t('page.downloadSuccess'));
      } else {
        toast.error(t('page.downloadLinkMissing'));
      }
      setExportRun(null);
      setIsPopoverOpen(false);
    },
  });

  const isDownloadingAll = isTriggering || !!exportRun;

  const handleDownloadAllEvidence = async () => {
    setIsTriggering(true);
    try {
      const result = await triggerBulkEvidenceExport({
        includeJson: includeRawJson,
      });
      setExportRun({
        runId: result.runId,
        accessToken: result.publicAccessToken,
      });
      toast.info(t('page.exportStarted'));
    } catch (err) {
      const noEvidence =
        err instanceof Error && err.message?.includes('No tasks with evidence found');
      if (noEvidence) {
        toast.info(t('page.noEvidenceToExport'));
      } else {
        toast.error(t('page.exportStartFailed'));
      }
      console.error('Evidence export error:', err);
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <Tabs defaultValue="evidence-list" onValueChange={setMainTab}>
      <PageLayout
        header={
          <PageHeader
            title={t('page.title')}
            actions={
              <div className="flex items-center gap-2">
                {hasEvidenceExportAccess && (
                  <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                    <PopoverTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 px-2 cursor-pointer">
                      {t('page.exportAllEvidence')}
                    </PopoverTrigger>
                    <PopoverContent align="end" side="bottom" sideOffset={8}>
                      <PopoverHeader>
                        <PopoverTitle>{t('page.exportOptions')}</PopoverTitle>
                        <PopoverDescription>{t('page.exportDescription')}</PopoverDescription>
                      </PopoverHeader>
                      <div className="flex items-center justify-between gap-3 py-1">
                        <span className="text-sm">{t('page.includeRawJson')}</span>
                        <Switch
                          checked={includeRawJson}
                          onCheckedChange={(checked) => setIncludeRawJson(checked)}
                        />
                      </div>
                      <Button
                        iconLeft={<ArrowDown />}
                        onClick={handleDownloadAllEvidence}
                        disabled={isDownloadingAll}
                        width="full"
                      >
                        {isDownloadingAll ? t('page.preparing') : t('page.exportButton')}
                      </Button>
                    </PopoverContent>
                  </Popover>
                )}
                {hasPermission('task', 'create') && (
                  <Button iconLeft={<Add />} onClick={() => setIsCreateSheetOpen(true)}>
                    {t('page.createEvidence')}
                  </Button>
                )}
              </div>
            }
          />
        }
      >
        <TaskList
          tasks={tasks}
          members={members}
          frameworkInstances={frameworkInstances}
          activeTab={activeTab}
          evidenceApprovalEnabled={evidenceApprovalEnabled}
          afterAnalytics={
            <div className="w-fit">
              <TabsList variant="underline">
                <TabsTrigger value="evidence-list">{t('page.overviewTab')}</TabsTrigger>
                <TabsTrigger value="settings">{t('page.settingsTab')}</TabsTrigger>
              </TabsList>
            </div>
          }
          showFiltersAndList={mainTab === 'evidence-list'}
        />
        {mainTab === 'settings' && (
          <UpdateOrganizationEvidenceApproval evidenceApprovalEnabled={evidenceApprovalEnabled} />
        )}
        <CreateTaskSheet
          members={members}
          controls={controls}
          open={isCreateSheetOpen}
          onOpenChange={setIsCreateSheetOpen}
          createTask={createTask}
        />
      </PageLayout>
    </Tabs>
  );
}
