'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { Badge } from '@gideon-defender/ui/badge';
import { Button, HStack, Stack, Text } from '@trycompai/design-system';
import { Add, Close } from '@trycompai/design-system/icons';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface TaskItemsHeaderProps {
  title: string;
  description: string;
  statsLoading: boolean;
  stats?: {
    total: number;
    byStatus: {
      todo: number;
      in_progress: number;
      in_review: number;
      done: number;
      canceled: number;
    };
  } | null;
  isCreateOpen: boolean;
  onToggleCreate: () => void;
}

export function TaskItemsHeader({
  title,
  description,
  statsLoading,
  stats,
  isCreateOpen,
  onToggleCreate,
}: TaskItemsHeaderProps) {
  const t = useTranslations('tasks');
  const { hasPermission } = usePermissions();
  const canCreateTask = hasPermission('task', 'create');

  return (
    <div className="flex items-start justify-between gap-4">
      <Stack gap="xs">
        <HStack gap="sm" align="center">
          <Text size="lg" weight="semibold">
            {title}
          </Text>
          {statsLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            stats &&
            stats.total > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {stats.total}
              </Badge>
            )
          )}
        </HStack>
        <Text size="sm" variant="muted">
          {description}
        </Text>
        {!statsLoading && stats && stats.total > 0 && (
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {stats.byStatus.todo > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                <Text size="xs" variant="muted" as="span">
                  {stats.byStatus.todo} {t('todo')}
                </Text>
              </div>
            )}
            {stats.byStatus.in_progress > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400" />
                <Text size="xs" variant="muted" as="span">
                  {stats.byStatus.in_progress} {t('inProgress')}
                </Text>
              </div>
            )}
            {stats.byStatus.in_review > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-purple-500 dark:bg-purple-400" />
                <Text size="xs" variant="muted" as="span">
                  {stats.byStatus.in_review} {t('inReview')}
                </Text>
              </div>
            )}
            {stats.byStatus.done > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <Text size="xs" variant="muted" as="span">
                  {stats.byStatus.done} {t('done')}
                </Text>
              </div>
            )}
            {stats.byStatus.canceled > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                <Text size="xs" variant="muted" as="span">
                  {stats.byStatus.canceled} {t('canceled')}
                </Text>
              </div>
            )}
          </div>
        )}
      </Stack>
      {canCreateTask && (
        <Button
          size="icon"
          onClick={onToggleCreate}
          variant={isCreateOpen ? 'outline' : 'default'}
          aria-label={isCreateOpen ? t('header.closeCreateTask') : t('header.createTask')}
        >
          {isCreateOpen ? <Close /> : <Add />}
        </Button>
      )}
    </div>
  );
}
