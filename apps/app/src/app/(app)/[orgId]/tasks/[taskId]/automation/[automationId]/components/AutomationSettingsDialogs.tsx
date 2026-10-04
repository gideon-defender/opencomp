'use client';

import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTaskAutomation } from '../hooks/use-task-automation';

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function DeleteAutomationDialog({ open, onOpenChange }: DeleteDialogProps) {
  const t = useTranslations('tasks');
  const router = useRouter();
  const { automation, deleteAutomation } = useTaskAutomation();
  const { orgId, taskId } = useParams<{
    orgId: string;
    taskId: string;
    automationId: string;
  }>();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteAutomation();
      onOpenChange(false);
      toast.success(t('settingsDialogs.deletedToast'));

      // Redirect back to task page after successful deletion
      router.push(`/${orgId}/tasks/${taskId}`);
    } catch {
      toast.error(t('settingsDialogs.deleteFailedToast'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settingsDialogs.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('settingsDialogs.deleteDescription', { name: automation?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('settingsDialogs.cancel')}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? t('settingsDialogs.deleting') : t('settingsDialogs.deleteButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
