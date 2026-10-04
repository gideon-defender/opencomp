'use client';

import { apiClient } from '@/app/lib/api-client';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from '@gideon-defender/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface DeleteFrameworkDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  frameworkId: string;
  frameworkName: string;
}

export function DeleteFrameworkDialog({
  isOpen,
  onOpenChange,
  frameworkId,
  frameworkName,
}: DeleteFrameworkDialogProps) {
  const router = useRouter();
  const t = useTranslations('dialogs');
  const tToasts = useTranslations('toasts');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleDelete = async () => {
    setError(undefined);
    setIsPending(true);
    try {
      await apiClient(`/framework/${frameworkId}`, { method: 'DELETE' });
      toast.success(tToasts('frameworkDeleted'));
      onOpenChange(false);
      router.push('/frameworks');
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : tToasts('frameworkDeleteFailed');
      setError(message);
      toast.error(message);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (isPending && !open) return;
        if (!open) setError(undefined);
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('editFramework.deleteConfirmTitle', { name: frameworkName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('editFramework.deleteConfirmDescription')}
            {error && (
              <p className="text-destructive mt-2 text-sm font-medium">
                {t('editFramework.errorPrefix')}: {error}
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={() => onOpenChange(false)}>
            {t('editFramework.cancel')}
          </AlertDialogCancel>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? t('editFramework.deleting') : t('editFramework.delete')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
