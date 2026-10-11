'use client';

import type { FindingTemplate } from '@/hooks/use-findings-api';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@gideon-defender/ui/alert-dialog';
import { Button } from '@gideon-defender/ui/button';
import { useTranslations } from 'next-intl';

interface FindingTemplateDeleteDialogProps {
  template: FindingTemplate | null;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function FindingTemplateDeleteDialog({
  template,
  isDeleting,
  onClose,
  onConfirm,
}: FindingTemplateDeleteDialogProps) {
  const t = useTranslations('overview');

  return (
    <AlertDialog open={template !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('findings.deleteTemplateTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('findings.deleteTemplateDescription', {
              title: template?.title ?? '',
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isDeleting} onClick={onConfirm}>
            {t('findings.deleteTemplate')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
