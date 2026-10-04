'use client';

import { RecentAuditLogs } from '@/components/RecentAuditLogs';
import { SelectAssignee } from '@/components/SelectAssignee';
import { useAuditLogs } from '@/hooks/use-audit-logs';
import { useOrganizationMembers } from '@/hooks/use-organization-members';
import { usePermissions } from '@/hooks/use-permissions';
import { downloadTaskEvidenceZip } from '@/lib/evidence-download';
import { useActiveMember } from '@/utils/auth-client';
import {
  CommentEntityType,
  EvidenceAutomation,
  EvidenceAutomationRun,
  type Control,
  type Member,
  type Task,
  type TaskFrequency,
  type User,
} from '@db';
import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import {
  Breadcrumb,
  HStack,
  Label,
  PageLayout,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from '@trycompai/design-system';
import { SubtractAlt } from '@trycompai/design-system/icons';
import {
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  SendHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Comments } from '../../../../../../components/comments/Comments';
import { MarkdownRenderer } from '../automation/[automationId]/components/markdown-renderer/markdown-renderer';
import { useTask } from '../hooks/use-task';
import { useTaskAutomations } from '../hooks/use-task-automations';
import { BrowserAutomations } from './BrowserAutomations';
import { TaskAutomations } from './TaskAutomations';
import { TaskAutomationStatusBadge } from './TaskAutomationStatusBadge';
import { TaskDeleteDialog } from './TaskDeleteDialog';
import { TaskIntegrationChecks } from './TaskIntegrationChecks';
import { TaskMainContent } from './TaskMainContent';
import { TaskPolicies } from './TaskPolicies';
import { TaskPropertiesSidebar } from './TaskPropertiesSidebar';

type AutomationWithRuns = EvidenceAutomation & {
  runs: EvidenceAutomationRun[];
};

interface SingleTaskProps {
  initialTask: Task & { fileUrls?: string[]; controls?: Control[] };
  initialMembers?: (Member & { user: User })[];
  initialAutomations: AutomationWithRuns[];
  isWebAutomationsEnabled: boolean;
  isPlatformAdmin: boolean;
  evidenceApprovalEnabled?: boolean;
}

export function SingleTask({
  initialTask,
  initialMembers,
  initialAutomations,
  isWebAutomationsEnabled,
  evidenceApprovalEnabled = false,
}: SingleTaskProps) {
  const params = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations('tasks.single');
  const orgId = params.orgId as string;
  const taskId = params.taskId as string;
  const defaultTab = searchParams.get('tab') || 'overview';

  const {
    task,
    isLoading,
    mutate: mutateTask,
    updateTask,
    regenerateTask,
    submitForReview,
    approveTask: approveTaskFn,
    rejectTask: rejectTaskFn,
  } = useTask({
    initialData: initialTask,
  });
  const { automations } = useTaskAutomations({
    initialData: initialAutomations,
  });
  const { mutate: mutateActivity } = useAuditLogs({ entityType: 'task', entityId: taskId });

  const { data: activeMember } = useActiveMember();
  const { members } = useOrganizationMembers({
    initialData: initialMembers,
  });

  const { hasPermission } = usePermissions();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isRegenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  const [requestApprovalDialogOpen, setRequestApprovalDialogOpen] = useState(false);
  const [selectedApproverId, setSelectedApproverId] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');

  if (!task || isLoading) {
    return null;
  }

  const canUpdateTask = hasPermission('task', 'update');
  const canDeleteTask = hasPermission('task', 'delete');
  const canReadPolicy = hasPermission('policy', 'read');

  const startEditingTitle = () => {
    if (!canUpdateTask) return;
    setTitleValue(task.title);
    setIsEditingTitle(true);
  };

  const saveTitleEdit = async () => {
    if (!titleValue.trim() || titleValue === task.title) {
      setIsEditingTitle(false);
      return;
    }
    try {
      await updateTask({ title: titleValue.trim() });
      toast.success(t('titleUpdated'));
      setIsEditingTitle(false);
      mutateActivity();
    } catch {
      toast.error(t('titleUpdateFailed'));
    }
  };

  const startEditingDescription = () => {
    if (!canUpdateTask) return;
    setDescriptionValue(task.description || '');
    setIsEditingDescription(true);
  };

  const saveDescriptionEdit = async () => {
    if (descriptionValue === (task.description || '')) {
      setIsEditingDescription(false);
      return;
    }
    try {
      await updateTask({ description: descriptionValue.trim() });
      toast.success(t('descriptionUpdated'));
      setIsEditingDescription(false);
      mutateActivity();
    } catch {
      toast.error(t('descriptionUpdateFailed'));
    }
  };

  const handleUpdateIntegrationSchedule = async (value: TaskFrequency) => {
    try {
      await updateTask({ integrationScheduleFrequency: value });
      toast.success(t('scheduleUpdated'));
      mutateActivity();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('scheduleUpdateFailed'));
    }
  };

  const handleUpdateTask = async (
    updates: Partial<
      Pick<Task, 'status' | 'assigneeId' | 'approverId' | 'frequency' | 'reviewDate'>
    > & {
      department?: string | null;
      notRelevantJustification?: string;
    },
  ) => {
    try {
      await updateTask({
        status: updates.status,
        assigneeId: updates.assigneeId,
        approverId: updates.approverId,
        frequency: updates.frequency,
        department: updates.department,
        reviewDate: updates.reviewDate ? String(updates.reviewDate) : undefined,
        notRelevantJustification: updates.notRelevantJustification,
      });
      toast.success(t('taskUpdated'));
      mutateActivity();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskUpdateFailed'));
    }
  };

  const handleApproveTask = async () => {
    try {
      await approveTaskFn();
      toast.success(t('approved'));
      mutateActivity();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('approveFailed'));
    }
  };

  const handleRejectTask = async () => {
    try {
      await rejectTaskFn();
      toast.success(t('rejected'));
      mutateActivity();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('rejectFailed'));
    }
  };

  const handleRequestApproval = () => {
    setSelectedApproverId(null);
    setRequestApprovalDialogOpen(true);
  };

  const handleSubmitForReview = async () => {
    if (!selectedApproverId) {
      toast.error(t('selectApprover'));
      return;
    }
    try {
      await submitForReview(selectedApproverId);
      toast.success(t('submittedForReview'));
      setRequestApprovalDialogOpen(false);
      mutateActivity();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('submitFailed'));
    }
  };

  const isAdminOrOwner =
    activeMember?.role?.includes('admin') || activeMember?.role?.includes('owner') || false;
  const isInReview = task.status === 'in_review';
  const isCurrentUserApprover =
    activeMember?.id && task.approverId && activeMember.id === task.approverId;
  const canApprove = evidenceApprovalEnabled && isInReview && isCurrentUserApprover;
  const canCancel =
    evidenceApprovalEnabled && isInReview && isAdminOrOwner && !isCurrentUserApprover;
  const approverMember =
    !task.approverId || !members ? null : members.find((m) => m.id === task.approverId);

  return (
    <PageLayout>
      <Breadcrumb
        items={[
          {
            label: t('breadcrumbEvidence'),
            href: `/${orgId}/tasks`,
            props: { render: <Link href={`/${orgId}/tasks`} /> },
          },
          { label: task.title, isCurrent: true },
        ]}
      />

      {/* Title + Description */}
      <Stack gap="xs">
        <HStack justify="between" align="center">
          {isEditingTitle ? (
            <input
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={saveTitleEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitleEdit();
                if (e.key === 'Escape') setIsEditingTitle(false);
              }}
              className="text-2xl font-semibold tracking-tight bg-transparent border-b border-primary outline-none flex-1"
              autoFocus
            />
          ) : (
            <HStack gap="sm" align="center">
              <h1
                onClick={startEditingTitle}
                className="text-2xl font-semibold tracking-tight cursor-pointer rounded px-1 -mx-1 hover:bg-muted/50 transition-colors"
              >
                {task.title}
              </h1>
              <TaskAutomationStatusBadge status={task.automationStatus} />
            </HStack>
          )}
        </HStack>
        {isEditingDescription ? (
          <textarea
            value={descriptionValue}
            onChange={(e) => setDescriptionValue(e.target.value)}
            onBlur={saveDescriptionEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setIsEditingDescription(false);
            }}
            className="text-sm text-muted-foreground bg-transparent border-b border-primary outline-none resize-none w-full"
            rows={5}
            autoFocus
          />
        ) : (
          // CS-98: descriptions authored in the Framework Editor use markdown
          // (bullets, bold, headings). Plain-text rendering with whiteSpace:
          // pre-line preserved newlines but showed raw "**" and "- " syntax.
          // Render through the shared MarkdownRenderer so the app matches
          // what admins see in the editor preview.
          <div
            onClick={startEditingDescription}
            className="text-sm text-muted-foreground cursor-pointer"
          >
            {task.description ? (
              <MarkdownRenderer content={task.description} />
            ) : (
              t('addDescriptionPlaceholder')
            )}
          </div>
        )}
      </Stack>

      {/* Not Relevant Banner */}
      {task.status === 'not_relevant' && task.notRelevantJustification && (
        <NotRelevantBanner justification={task.notRelevantJustification} />
      )}

      {/* Approval Banner */}
      {evidenceApprovalEnabled && isInReview && (
        <ApprovalBanner
          canApprove={!!canApprove}
          canCancel={canCancel}
          approverMember={approverMember}
          onApprove={handleApproveTask}
          onReject={handleRejectTask}
        />
      )}

      {/* Tabs */}
      <Tabs defaultValue={defaultTab}>
        <Stack gap="lg">
          <TabsList variant="underline">
            <TabsTrigger value="overview">{t('tabOverview')}</TabsTrigger>
            {task.automationStatus !== 'MANUAL' && (
              <TabsTrigger value="automations">{t('tabAutomations')}</TabsTrigger>
            )}
            {canReadPolicy && <TabsTrigger value="mappings">{t('tabMappings')}</TabsTrigger>}
            <TabsTrigger value="comments">{t('tabComments')}</TabsTrigger>
            <TabsTrigger value="activity">{t('tabActivity')}</TabsTrigger>
            <TabsTrigger value="settings">{t('tabSettings')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Stack gap="lg">
              <TaskPropertiesSidebar
                handleUpdateTask={handleUpdateTask}
                evidenceApprovalEnabled={evidenceApprovalEnabled}
                onRequestApproval={handleRequestApproval}
              />
              <Stack gap="sm">
                <Label>{t('commentsLabel')}</Label>
                <Comments
                  entityId={task.id}
                  entityType={CommentEntityType.task}
                  mentionResource="evidence"
                  organizationId={orgId}
                />
              </Stack>
              <TaskMainContent task={task} showComments={false} />
            </Stack>
          </TabsContent>

          <TabsContent value="mappings">
            <Stack gap="lg">
              <TaskPolicies />
            </Stack>
          </TabsContent>

          <TabsContent value="automations">
            <Stack gap="lg">
              <TaskIntegrationChecks
                taskId={task.id}
                onTaskUpdated={() => mutateTask()}
                isManualTask={task.automationStatus === 'MANUAL'}
                scheduleFrequency={task.integrationScheduleFrequency ?? undefined}
                lastRunAt={task.integrationLastRunAt ?? null}
                onScheduleChange={canUpdateTask ? handleUpdateIntegrationSchedule : undefined}
              />
              <TaskAutomations
                automations={automations || []}
                isManualTask={task.automationStatus === 'MANUAL'}
              />
              {isWebAutomationsEnabled && (
                <BrowserAutomations
                  taskId={task.id}
                  isManualTask={task.automationStatus === 'MANUAL'}
                />
              )}
            </Stack>
          </TabsContent>

          <TabsContent value="comments">
            <Comments
              entityId={task.id}
              entityType={CommentEntityType.task}
              mentionResource="evidence"
              organizationId={orgId}
            />
          </TabsContent>

          <TabsContent value="activity">
            <TaskActivitySection taskId={taskId} />
          </TabsContent>

          <TabsContent value="settings">
            <Stack gap="lg">
              <HStack justify="between" align="center">
                <Stack gap="none">
                  <Text size="sm" weight="medium">
                    {t('downloadEvidence')}
                  </Text>
                  <Text size="xs" variant="muted">
                    {t('downloadEvidenceDescription')}
                  </Text>
                </Stack>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await downloadTaskEvidenceZip({
                        taskId: task.id,
                        taskTitle: task.title,
                        includeJson: true,
                      });
                      toast.success(t('evidenceDownloaded'));
                    } catch {
                      toast.error(t('evidenceDownloadFailed'));
                    }
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {t('download')}
                </Button>
              </HStack>

              <div className="border-t" />

              {canUpdateTask && (
                <>
                  <HStack justify="between" align="center">
                    <Stack gap="none">
                      <Text size="sm" weight="medium">
                        {t('resetToDefaults')}
                      </Text>
                      <Text size="xs" variant="muted">
                        {t('resetToDefaultsDescription')}
                      </Text>
                    </Stack>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRegenerateConfirmOpen(true)}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('regenerate')}
                    </Button>
                  </HStack>
                  <div className="border-t" />
                </>
              )}
              {canDeleteTask && (
                <HStack justify="between" align="center">
                  <Stack gap="none">
                    <Text size="sm" weight="medium">
                      {t('deleteEvidence')}
                    </Text>
                    <Text size="xs" variant="muted">
                      {t('deleteEvidenceDescription')}
                    </Text>
                  </Stack>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteDialogOpen(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </HStack>
              )}
            </Stack>
          </TabsContent>
        </Stack>
      </Tabs>

      {/* Dialogs */}
      <TaskDeleteDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        task={task}
      />

      <Dialog open={isRegenerateConfirmOpen} onOpenChange={setRegenerateConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('regenerateTitle')}</DialogTitle>
            <DialogDescription>{t('regenerateDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenerateConfirmOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={async () => {
                setRegenerateConfirmOpen(false);
                try {
                  await regenerateTask();
                  toast.success(t('regenerated'));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t('regenerateFailed'));
                }
              }}
            >
              {t('regenerate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requestApprovalDialogOpen} onOpenChange={setRequestApprovalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('requestApprovalTitle')}</DialogTitle>
            <DialogDescription>{t('requestApprovalDescription')}</DialogDescription>
          </DialogHeader>
          <SelectAssignee
            assignees={members?.filter((m) => m.id !== activeMember?.id) ?? []}
            assigneeId={selectedApproverId ?? ''}
            onAssigneeChange={(id) => setSelectedApproverId(id)}
            withTitle={false}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestApprovalDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSubmitForReview} disabled={!selectedApproverId}>
              <SendHorizontal className="h-4 w-4 mr-2" />
              {t('submitForReview')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

function TaskActivitySection({ taskId }: { taskId: string }) {
  const { logs } = useAuditLogs({ entityType: 'task', entityId: taskId });
  return <RecentAuditLogs logs={logs} />;
}

function NotRelevantBanner({ justification }: { justification: string }) {
  const t = useTranslations('tasks.single');
  return (
    <div className="rounded-lg border border-l-4 border-border border-l-muted-foreground/50 bg-muted/30 p-4">
      <HStack gap="sm" align="start">
        <SubtractAlt size={20} className="text-muted-foreground mt-0.5 shrink-0" />
        <Stack gap="xs">
          <Text size="sm" weight="medium">
            {t('markedNotRelevant')}
          </Text>
          <Text size="sm" variant="muted">
            {justification}
          </Text>
        </Stack>
      </HStack>
    </div>
  );
}

function ApprovalBanner({
  canApprove,
  canCancel,
  approverMember,
  onApprove,
  onReject,
}: {
  canApprove: boolean;
  canCancel: boolean;
  approverMember: { user: { name: string | null; email: string } } | null | undefined;
  onApprove: () => void;
  onReject: () => void;
}) {
  const t = useTranslations('tasks.single');
  if (canApprove) {
    return (
      <div className="rounded-lg border border-l-4 border-border border-l-orange-400 bg-orange-50 dark:bg-orange-950/20 p-4">
        <HStack justify="between" align="center">
          <HStack gap="sm" align="start">
            <CheckCircle2 className="h-5 w-5 text-orange-500 mt-0.5 shrink-0" />
            <Stack gap="none">
              <Text size="sm" weight="medium">
                {t('yourApprovalRequired')}
              </Text>
              <Text size="xs" variant="muted">
                {t('reviewAndDecide')}
              </Text>
            </Stack>
          </HStack>
          <HStack gap="sm">
            <Button variant="outline" size="sm" onClick={onReject}>
              <XCircle className="h-4 w-4 mr-2" />
              {t('reject')}
            </Button>
            <Button size="sm" onClick={onApprove}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {t('approve')}
            </Button>
          </HStack>
        </HStack>
      </div>
    );
  }

  const approverName = approverMember
    ? approverMember.user.name || approverMember.user.email
    : t('theApprover');

  return (
    <div className="rounded-lg border border-l-4 border-border border-l-muted-foreground/50 bg-background p-4">
      <HStack justify="between" align="center">
        <HStack gap="sm" align="start">
          <Clock className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <Stack gap="none">
            <Text size="sm" weight="medium">
              {t('pendingApproval')}
            </Text>
            <Text size="xs" variant="muted">
              {t('waitingForReview', { approverName })}
            </Text>
          </Stack>
        </HStack>
        {canCancel && (
          <Button variant="outline" size="sm" onClick={onReject}>
            <XCircle className="h-4 w-4 mr-2" />
            {t('cancel')}
          </Button>
        )}
      </HStack>
    </div>
  );
}
