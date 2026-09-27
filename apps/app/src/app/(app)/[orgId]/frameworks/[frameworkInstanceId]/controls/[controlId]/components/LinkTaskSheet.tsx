'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { apiClient } from '@/lib/api-client';
import {
  Button,
  Checkbox,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Text,
} from '@trycompai/design-system';
import { Link as LinkIcon } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useControlOptions } from './useControlOptions';

export function LinkTaskSheet({
  controlId,
  frameworkInstanceId,
  alreadyLinkedTaskIds,
}: {
  controlId: string;
  frameworkInstanceId: string;
  alreadyLinkedTaskIds: string[];
}) {
  const { hasPermission } = usePermissions();
  const t = useTranslations('frameworks');
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { tasks, isLoading } = useControlOptions(isOpen);
  const linked = useMemo(() => new Set(alreadyLinkedTaskIds), [alreadyLinkedTaskIds]);
  const options = useMemo(() => tasks.filter((t) => !linked.has(t.id)), [tasks, linked]);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) setSelected(new Set());
  }

  if (!hasPermission('control', 'update')) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await apiClient.post(
        `/v1/controls/${controlId}/tasks/link?frameworkInstanceId=${frameworkInstanceId}`,
        { taskIds: Array.from(selected) },
      );
      if (response.error) throw new Error(response.error);
      toast.success(t('controls.tasksLinked'));
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('controls.failedToLinkTasks'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button size="sm" iconLeft={<LinkIcon size={16} />} onClick={() => setIsOpen(true)}>
        {t('controls.linkTask')}
      </Button>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('controls.linkExistingTasksTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {isLoading ? (
              <Text size="sm" variant="muted">
                {t('controls.loadingTasks')}
              </Text>
            ) : options.length === 0 ? (
              <Text size="sm" variant="muted">
                {t('controls.noAdditionalTasks')}
              </Text>
            ) : (
              <div className="space-y-2">
                {options.map((task) => (
                  <label
                    key={task.id}
                    className="flex items-start gap-3 rounded border p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.has(task.id)}
                      onCheckedChange={() => toggle(task.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{task.title}</div>
                    </div>
                  </label>
                ))}
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSubmit} disabled={selected.size === 0 || isSubmitting}>
                    {t('controls.linkTaskCount', {
                      count: selected.size,
                    })}
                  </Button>
                </div>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
