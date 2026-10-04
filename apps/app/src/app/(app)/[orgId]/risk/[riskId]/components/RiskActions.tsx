'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { useRisk } from '@/hooks/use-risks';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@trycompai/design-system';
import { Settings } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';

export function RiskActions({ riskId }: { riskId: string; orgId: string }) {
  const { hasPermission } = usePermissions();
  const { mutate: globalMutate } = useSWRConfig();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const t = useTranslations('risk');
  const tCommon = useTranslations('overview');

  const { mutate: refreshRisk } = useRisk(riskId);

  if (!hasPermission('risk', 'update')) return null;

  const handleConfirm = async () => {
    setIsConfirmOpen(false);
    setIsRegenerating(true);
    toast.info(t('detail.regeneratingToast'));

    try {
      const response = await fetch(`/api/risks/${riskId}/regenerate-mitigation`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || tCommon('common.errorOccurred'));
      }
      toast.success(t('detail.regenerationTriggered'));
      refreshRisk();
      globalMutate((key) => Array.isArray(key) && key[0] === 'risks', undefined, {
        revalidate: true,
      });
      globalMutate(
        (key) => typeof key === 'string' && key.includes('/v1/comments') && key.includes(riskId),
        undefined,
        { revalidate: true },
      );
    } catch {
      toast.error(t('detail.regenTriggerFailed'));
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger variant="ellipsis">
          <Settings size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setIsConfirmOpen(true)}>
            {t('detail.regenerateRiskMitigation')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.regenerateMitigation')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.regenerateConfirmation')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRegenerating}>
              {tCommon('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isRegenerating}>
              {isRegenerating ? t('detail.working') : t('detail.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
