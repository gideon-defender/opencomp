'use client';

import { apiClient } from '@/app/lib/api-client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@gideon-defender/ui/alert-dialog';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface DeleteFrameworkFamilyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  familyId: string;
  familyName: string;
}

export function DeleteFrameworkFamilyDialog({
  isOpen,
  onOpenChange,
  familyId,
  familyName,
}: DeleteFrameworkFamilyDialogProps) {
  const router = useRouter();
  const t = useTranslations('dialogs');
  const tToasts = useTranslations('toasts');
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await apiClient(`/framework-family/${familyId}`, { method: 'DELETE' });
      toast.success(tToasts('familyDeleted'));
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tToasts('familyDeleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('familyDialog.deleteConfirmTitle', { name: familyName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('familyDialog.deleteConfirmDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{t('familyDialog.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              handleDelete();
            }}
            disabled={isDeleting}
          >
            {isDeleting ? t('familyDialog.deleting') : t('familyDialog.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
