'use client';

import { usePermissions } from '@/hooks/use-permissions';
import {
  useTaskItems,
  useTaskItemsStats,
  type TaskItemEntityType,
  type TaskItemFilters,
  type TaskItemPriority,
  type TaskItemSortBy,
  type TaskItemSortOrder,
  type TaskItemStatus,
} from '@/hooks/use-task-items';
import {
  Button,
  DataTableFilters,
  DataTableHeader,
  DataTableSearch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Text,
} from '@trycompai/design-system';
import { Add } from '@trycompai/design-system/icons';
import { Loader2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { TaskItemCreateDialog } from './TaskItemCreateDialog';
import { TaskItemFocusView } from './TaskItemFocusView';
import { TaskItemList } from './TaskItemList';

interface TaskItemsProps {
  entityId: string;
  entityType: TaskItemEntityType;
  title?: string;
  description?: string;
  anchorId?: string;
  onFocusModeChange?: (isFocusMode: boolean) => void;
}

export const TaskItems = ({
  entityId,
  entityType,
  anchorId = 'task-items',
  onFocusModeChange,
}: TaskItemsProps) => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(5);
  const [sortBy] = useState<TaskItemSortBy>('createdAt');
  const [sortOrder] = useState<TaskItemSortOrder>('desc');
  const [filters, setFilters] = useState<TaskItemFilters>({});
  const [search, setSearch] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selectedTaskItemId, setSelectedTaskItemId] = useState<string | null>(
    () => searchParams.get('taskItemId') ?? null,
  );
  // Stay in sync with the URL param, adjusted during render.
  const taskItemIdFromUrl = searchParams.get('taskItemId');
  const [prevTaskItemIdFromUrl, setPrevTaskItemIdFromUrl] = useState(taskItemIdFromUrl);
  if (prevTaskItemIdFromUrl !== taskItemIdFromUrl) {
    setPrevTaskItemIdFromUrl(taskItemIdFromUrl);
    setSelectedTaskItemId(taskItemIdFromUrl || null);
  }
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('task', 'create');

  const {
    data: taskItemsResponse,
    error: taskItemsError,
    mutate: refreshTaskItems,
  } = useTaskItems(entityId, entityType, page, limit, sortBy, sortOrder, filters);

  const { mutate: refreshStats } = useTaskItemsStats(entityId, entityType);

  const handleFilterChange = (
    filterType: 'status' | 'priority' | 'assigneeId',
    value: string | null,
  ) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === null || value === 'all') {
        delete next[filterType];
      } else if (filterType === 'assigneeId') {
        next.assigneeId = value === 'unassigned' ? '__unassigned__' : value;
      } else if (filterType === 'status') {
        next.status = value as TaskItemStatus;
      } else {
        next.priority = value as TaskItemPriority;
      }
      return next;
    });
    setPage(1);
  };

  useEffect(() => {
    onFocusModeChange?.(Boolean(selectedTaskItemId));
  }, [selectedTaskItemId, onFocusModeChange]);

  const handleSelectTaskItemId = (taskItemId: string | null) => {
    setSelectedTaskItemId(taskItemId);
    const next = new URLSearchParams(searchParams.toString());
    if (taskItemId) {
      next.set('taskItemId', taskItemId);
    } else {
      next.delete('taskItemId');
    }
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}#${anchorId}`, { scroll: false });
  };

  // Keep the last successful response for display while refetching, held in
  // state and synced during render instead of a ref read during render.
  const [previousData, setPreviousData] = useState(taskItemsResponse);
  if (taskItemsResponse && previousData !== taskItemsResponse) {
    setPreviousData(taskItemsResponse);
  }

  const displayResponse = taskItemsResponse || previousData;
  const allTaskItems = useMemo(() => displayResponse?.data?.data || [], [displayResponse]);
  const paginationMeta = displayResponse?.data?.meta;
  const isFocusMode = Boolean(selectedTaskItemId);
  const selectedTaskItem = allTaskItems.find((t) => t.id === selectedTaskItemId) || null;

  // Client-side search filter
  const filteredTaskItems = useMemo(() => {
    if (!search.trim()) return allTaskItems;
    const q = search.toLowerCase();
    return allTaskItems.filter((t) => t.title.toLowerCase().includes(q));
  }, [allTaskItems, search]);

  // Polling for "Verify risk assessment" generating tasks
  const hasGeneratingTask = useMemo(
    () =>
      allTaskItems.some((t) => t.title === 'Verify risk assessment' && t.status === 'in_progress'),
    [allTaskItems],
  );
  useEffect(() => {
    if (selectedTaskItemId || !hasGeneratingTask) return;
    const interval = setInterval(() => refreshTaskItems(), 3000);
    return () => clearInterval(interval);
  }, [hasGeneratingTask, refreshTaskItems, selectedTaskItemId]);

  const handleCreateSuccess = () => {
    setIsCreateOpen(false);
    refreshTaskItems();
    refreshStats();
    if (page !== 1) setPage(1);
  };

  // Focus mode
  if (isFocusMode && selectedTaskItem) {
    return (
      <section id={anchorId} className="scroll-mt-24">
        <TaskItemFocusView
          taskItem={selectedTaskItem}
          entityId={entityId}
          entityType={entityType}
          page={page}
          limit={limit}
          sortBy={sortBy}
          sortOrder={sortOrder}
          filters={filters}
          onBack={() => handleSelectTaskItemId(null)}
          onStatusOrPriorityChange={refreshStats}
        />
      </section>
    );
  }

  const isInitialLoad = !taskItemsResponse && !taskItemsError && allTaskItems.length === 0;

  return (
    <section id={anchorId} className="scroll-mt-24">
      <div className="flex flex-col gap-4">
        <DataTableHeader>
          <DataTableSearch placeholder="Search tasks..." value={search} onChange={setSearch} />
          <DataTableFilters>
            <Select
              value={filters.status || 'all'}
              onValueChange={(v) => handleFilterChange('status', v === 'all' ? null : v)}
            >
              <SelectTrigger>
                {filters.status ? filters.status.replace('_', ' ') : 'All Status'}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="todo">Todo</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="in_review">In Review</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="canceled">Canceled</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.priority || 'all'}
              onValueChange={(v) => handleFilterChange('priority', v === 'all' ? null : v)}
            >
              <SelectTrigger>{filters.priority || 'All Priority'}</SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>

            {canCreate && (
              <Button onClick={() => setIsCreateOpen(true)} iconLeft={<Add />}>
                Create Task
              </Button>
            )}
          </DataTableFilters>
        </DataTableHeader>

        {isInitialLoad ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <TaskItemList
              taskItems={filteredTaskItems}
              entityId={entityId}
              entityType={entityType}
              page={page}
              limit={limit}
              sortBy={sortBy}
              sortOrder={sortOrder}
              filters={filters}
              onSelectTaskItemId={handleSelectTaskItemId}
              onStatusOrPriorityChange={refreshStats}
            />
            {paginationMeta && paginationMeta.totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <Text size="xs" variant="muted" as="span">
                  Page {page} of {paginationMeta.totalPages}
                </Text>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page >= paginationMeta.totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <TaskItemCreateDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        entityId={entityId}
        entityType={entityType}
        page={page}
        limit={limit}
        sortBy={sortBy}
        sortOrder={sortOrder}
        filters={filters}
        onSuccess={handleCreateSuccess}
      />
    </section>
  );
};
