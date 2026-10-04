'use client';

import { SelectAssignee } from '@/components/SelectAssignee';
import { useAssignableMembers } from '@/hooks/use-organization-members';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  TaskItemEntityType,
  TaskItemFilters,
  TaskItemPriority,
  TaskItemSortBy,
  TaskItemSortOrder,
  TaskItemStatus,
} from '@/hooks/use-task-items';
import { useOptimisticTaskItems } from '@/hooks/use-task-items';
import { filterMembersByOwnerOrAdmin } from '@/utils/filter-members-by-role';
import { Button } from '@gideon-defender/ui/button';
import { Input } from '@gideon-defender/ui/input';
import { Label } from '@gideon-defender/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui/select';
import type { JSONContent } from '@tiptap/react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { TaskRichDescriptionField } from './TaskRichDescriptionField';
import { useTaskItemAttachmentUpload } from './hooks/use-task-item-attachment-upload';

interface TaskSmartFormProps {
  entityId: string;
  entityType: TaskItemEntityType;
  page?: number;
  limit?: number;
  sortBy?: TaskItemSortBy;
  sortOrder?: TaskItemSortOrder;
  filters?: TaskItemFilters;
  onSuccess?: () => void;
  onCancel?: () => void;
  initialValues?: {
    title?: string;
    description?: JSONContent | string;
    status?: TaskItemStatus;
    priority?: TaskItemPriority;
    assigneeId?: string | null;
  };
}

const STATUS_VALUES: TaskItemStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'canceled'];

const PRIORITY_VALUES: TaskItemPriority[] = ['urgent', 'high', 'medium', 'low'];

export function TaskSmartForm({
  entityId,
  entityType,
  page = 1,
  limit = 5,
  sortBy = 'createdAt',
  sortOrder = 'desc',
  filters = {},
  onSuccess,
  onCancel,
  initialValues,
}: TaskSmartFormProps) {
  const t = useTranslations('tasks');
  const tt = useTranslations('toasts');
  const [title, setTitle] = useState(initialValues?.title || '');
  const [description, setDescription] = useState<JSONContent | null>(
    typeof initialValues?.description === 'object' ? initialValues.description : null,
  );
  const [status, setStatus] = useState<TaskItemStatus>(initialValues?.status || 'todo');
  const [priority, setPriority] = useState<TaskItemPriority>(initialValues?.priority || 'medium');
  const [assigneeId, setAssigneeId] = useState<string | null>(initialValues?.assigneeId ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('task', 'create');

  const { optimisticCreate } = useOptimisticTaskItems(
    entityId,
    entityType,
    page,
    limit,
    sortBy,
    sortOrder,
    filters,
  );

  const { members } = useAssignableMembers();
  const { uploadAttachment, isUploading } = useTaskItemAttachmentUpload({
    entityId,
    entityType,
  });

  const statusOptions = useMemo(
    () =>
      STATUS_VALUES.map((value) => ({
        value,
        label:
          value === 'todo'
            ? t('todo')
            : value === 'in_progress'
              ? t('inProgress')
              : value === 'in_review'
                ? t('inReview')
                : value === 'done'
                  ? t('done')
                  : t('canceled'),
      })),
    [t],
  );

  const priorityOptions = useMemo(
    () =>
      PRIORITY_VALUES.map((value) => ({
        value,
        label: t(`smartForm.${value}`),
      })),
    [t],
  );

  // Filter members to only show owner and admin roles
  const assignableMembers = useMemo(() => {
    if (!members) return [];
    return filterMembersByOwnerOrAdmin({ members });
  }, [members]);

  // Only show admin/owner users in mention suggestions
  const mentionMembers = useMemo(() => {
    if (!members) return [];
    return members
      .filter((member) => {
        if (!member.role) return false;
        const roles = member.role.split(',').map((r) => r.trim().toLowerCase());
        return roles.includes('owner') || roles.includes('admin');
      })
      .map((member) => ({
        id: member.user.id,
        name: member.user.name || member.user.email || 'Unknown',
        email: member.user.email || '',
        image: member.user.image,
      }));
  }, [members]);

  const handleFileUpload = useCallback(
    async (
      files: File[],
    ): Promise<
      { id: string; name: string; size?: number; downloadUrl?: string; type?: string }[]
    > => {
      if (!files.length) return [];

      const results = [];
      for (const file of files) {
        try {
          const result = await uploadAttachment(file);
          if (result?.id) {
            results.push({
              id: result.id,
              name: result.name,
              size: result.size,
              downloadUrl: result.downloadUrl,
              type: result.type,
            });
            toast.success(tt('fileAttached', { name: file.name }));
          }
        } catch (error) {
          console.error('Failed to upload file:', error);
          toast.error(
            tt('fileUploadFailed', {
              name: file.name,
              error: error instanceof Error ? error.message : tt('unknownError'),
            }),
          );
        }
      }
      return results;
    },
    [uploadAttachment, tt],
  );

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error(tt('titleRequired'));
      return;
    }

    setIsSubmitting(true);

    try {
      // Convert description JSON to string for API
      const descriptionText = description ? JSON.stringify(description) : undefined;

      await optimisticCreate({
        title: title.trim(),
        description: descriptionText,
        status,
        priority,
        entityId,
        entityType,
        assigneeId: assigneeId || undefined,
      });
      toast.success(tt('taskCreated'));

      // Reset form
      setTitle('');
      setDescription(null);
      setStatus('todo');
      setPriority('medium');
      setAssigneeId(null);

      // Call success callback
      onSuccess?.();
    } catch (error) {
      console.error('Error creating task item:', error);
      toast.error(error instanceof Error ? error.message : tt('taskCreateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === 'Enter' &&
      !isSubmitting &&
      title.trim()
    ) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="task-title" className="text-sm font-medium">
          {t('smartForm.titleLabel')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="task-title"
          placeholder={t('smartForm.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isSubmitting}
          onKeyDown={handleKeyDown}
          className="bg-background"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-description" className="text-sm font-medium">
          {t('smartForm.descriptionLabel')}
        </Label>
        <TaskRichDescriptionField
          value={description}
          onChange={setDescription}
          onFileUpload={handleFileUpload}
          members={mentionMembers}
          disabled={isSubmitting}
          placeholder={t('smartForm.descriptionPlaceholder')}
          entityId={entityId}
          entityType={entityType}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="task-status" className="text-sm font-medium">
            {t('smartForm.statusLabel')}
          </Label>
          <Select value={status} onValueChange={(value) => setStatus(value as TaskItemStatus)}>
            <SelectTrigger id="task-status" className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="task-priority" className="text-sm font-medium">
            {t('smartForm.priorityLabel')}
          </Label>
          <Select
            value={priority}
            onValueChange={(value) => setPriority(value as TaskItemPriority)}
          >
            <SelectTrigger id="task-priority" className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {assignableMembers && assignableMembers.length > 0 && (
        <div className="space-y-2">
          <SelectAssignee
            assigneeId={assigneeId}
            assignees={assignableMembers}
            onAssigneeChange={setAssigneeId}
            disabled={isSubmitting}
            withTitle={true}
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting || isUploading}
            className="h-8 px-3"
          >
            {t('smartForm.cancel')}
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={isSubmitting || isUploading || !title.trim() || !canCreate}
          className="h-8 px-3"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              {t('smartForm.creating')}
            </>
          ) : (
            t('smartForm.createTask')
          )}
        </Button>
      </div>
    </div>
  );
}
