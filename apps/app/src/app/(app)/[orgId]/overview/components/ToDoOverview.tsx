'use client';

import { useApiSWR } from '@/hooks/use-api-swr';
import { usePermissions } from '@/hooks/use-permissions';
import { Policy, Task } from '@db';
import { Button } from '@gideon-defender/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@gideon-defender/ui/card';
import { ScrollArea } from '@gideon-defender/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gideon-defender/ui/tabs';
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  ListCheck,
  NotebookText,
  Play,
  Upload,
  UserMinus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import {
  formatQuickActionStatus,
  getQuickActionProgressWidth,
  type PendingOffboardingResponse,
  usePublishAllPoliciesAction,
} from './overview-quick-actions';

export function ToDoOverview({
  totalPolicies,
  totalTasks,
  remainingPolicies,
  remainingTasks,
  unpublishedPolicies,
  incompleteTasks,
  policiesInReview,
  organizationId,
  currentMember,
  onboardingTriggerJobId,
}: {
  totalPolicies: number;
  totalTasks: number;
  remainingPolicies: number;
  remainingTasks: number;
  unpublishedPolicies: Policy[];
  incompleteTasks: Task[];
  policiesInReview: Policy[];
  organizationId: string;
  currentMember: { id: string; role: string } | null;
  onboardingTriggerJobId: string | null;
}) {
  const { hasPermission } = usePermissions();
  const t = useTranslations('overview');
  const [activeTab, setActiveTab] = useState(
    unpublishedPolicies.length === 0 ? 'tasks' : 'policies',
  );

  const {
    data: pendingData,
    isLoading: isPendingLoading,
    error: pendingError,
  } = useApiSWR<PendingOffboardingResponse>('/v1/offboarding-checklist/pending');
  const pendingOffboardings = pendingData?.data?.members ?? [];

  // Default to the offboarding tab once pending offboardings finish loading.
  // Adjust-during-render instead of an effect to avoid setState-in-effect.
  if (!isPendingLoading && pendingOffboardings.length > 0 && activeTab !== 'offboarding') {
    setActiveTab('offboarding');
  }

  const isOnboardingInProgress = !!onboardingTriggerJobId;

  const canPublishPolicies = hasPermission('policy', 'update');
  const { handlePublishAllClick, isPublishing, publishAllPoliciesDialog } =
    usePublishAllPoliciesAction({
      unpublishedPolicies,
    });
  const width = getQuickActionProgressWidth({
    totalPolicies,
    totalTasks,
    unpublishedPolicies: unpublishedPolicies.length,
    incompleteTasks: incompleteTasks.length,
  });

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">{t('todo.title')}</CardTitle>
        </div>

        <div className="bg-secondary/50 relative mt-2 h-1 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full transition-all"
            style={{
              width: `${width}%`,
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="policies" className="flex items-center gap-2">
              <FileText className="h-3 w-3" />
              {t('todo.policiesCount', { count: remainingPolicies })}
            </TabsTrigger>
            <TabsTrigger value="tasks" className="flex items-center gap-2">
              <Upload className="h-3 w-3" />
              {t('todo.tasksCount', { count: remainingTasks })}
            </TabsTrigger>
            <TabsTrigger value="offboarding" className="flex items-center gap-2">
              <UserMinus className="h-3 w-3" />
              {t('todo.offboardingCount', { count: pendingOffboardings.length })}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="policies" className="mt-4">
            {canPublishPolicies && unpublishedPolicies.length > 0 && (
              <div className="flex w-full mb-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePublishAllClick}
                  className="flex items-center gap-2 w-full"
                  disabled={isOnboardingInProgress || isPublishing}
                  title={isOnboardingInProgress ? t('todo.waitForOnboarding') : undefined}
                >
                  <Play className="h-3 w-3" />
                  {isOnboardingInProgress
                    ? t('todo.onboardingInProgress')
                    : t('todo.publishAllPolicies')}
                </Button>
              </div>
            )}

            {unpublishedPolicies.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-accent p-3">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm">{t('todo.allPoliciesPublished')}</span>
              </div>
            ) : (
              <div className="h-[300px]">
                <ScrollArea className="h-full">
                  <div className="space-y-0 pr-4">
                    {unpublishedPolicies.map((policy, index) => (
                      <div key={policy.id}>
                        <div className="flex items-start justify-between py-3 px-1">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full">
                              <NotebookText className="h-3 w-3" />
                            </div>
                            <div className="flex flex-col flex-1 min-w-0">
                              <span className="text-sm font-medium text-foreground">
                                {policy.name}
                              </span>
                              <span className="text-xs text-muted-foreground capitalize">
                                {t('common.status')}: {formatQuickActionStatus(policy.status)}
                              </span>
                            </div>
                          </div>
                          <Button asChild size="icon" variant="outline">
                            <Link href={`/${organizationId}/policies/${policy.id}`}>
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                        {index < unpublishedPolicies.length - 1 && (
                          <div className="border-t border-muted/30" />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </TabsContent>

          <TabsContent value="tasks" className="mt-4">
            {incompleteTasks.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-accent p-3">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="text-sm text-primary">{t('todo.allTasksCompleted')}</span>
              </div>
            ) : (
              <div className="h-[300px]">
                <ScrollArea className="h-full">
                  <div className="space-y-0 pr-4">
                    {incompleteTasks.map((task, index) => (
                      <div key={task.id}>
                        <div className="flex items-start justify-between py-3 px-1">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full">
                              <ListCheck className="h-3 w-3" />
                            </div>
                            <div className="flex flex-col flex-1 min-w-0">
                              <span className="text-sm font-medium text-foreground">
                                {task.title}
                              </span>
                              <span className="text-xs text-muted-foreground capitalize">
                                {t('common.status')}: {formatQuickActionStatus(task.status)}
                              </span>
                            </div>
                          </div>
                          <Button asChild size="icon" variant="outline">
                            <Link href={`/${organizationId}/tasks/${task.id}`}>
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                        {index < incompleteTasks.length - 1 && (
                          <div className="border-t border-muted/30" />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </TabsContent>

          <TabsContent value="offboarding" className="mt-4">
            {isPendingLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-accent p-3">
                <span className="text-sm text-muted-foreground">
                  {t('todo.loadingOffboardings')}
                </span>
              </div>
            ) : pendingError ? (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-accent p-3">
                <span className="text-sm text-destructive">
                  {t('todo.failedToLoadOffboardings')}
                </span>
              </div>
            ) : pendingOffboardings.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-accent p-3">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="text-sm text-primary">{t('todo.noPendingOffboardings')}</span>
              </div>
            ) : (
              <div className="h-[300px]">
                <ScrollArea className="h-full">
                  <div className="space-y-0 pr-4">
                    {pendingOffboardings.map((member, index) => (
                      <div key={member.memberId}>
                        <div className="flex items-start justify-between px-1 py-3">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full">
                              <UserMinus className="h-3 w-3" />
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="text-sm font-medium text-foreground">
                                {t('todo.completeOffboardingFor', { name: member.name })}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t('todo.tasksDone', {
                                  current: member.completedItems,
                                  total: member.totalItems,
                                })}
                              </span>
                            </div>
                          </div>
                          <Button asChild size="icon" variant="outline">
                            <Link
                              href={`/${organizationId}/people/${member.memberId}?tab=offboarding`}
                            >
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                        {index < pendingOffboardings.length - 1 && (
                          <div className="border-t border-muted/30" />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      {publishAllPoliciesDialog}
    </Card>
  );
}
