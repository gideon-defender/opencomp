'use client';

import { useState } from 'react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@trycompai/design-system';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

interface PolicyImageResetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  policyId: number;
  onRefresh: () => void;
}

export function PolicyImageResetModal({
  open,
  onOpenChange,
  organizationId,
  policyId,
  onRefresh,
}: PolicyImageResetModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const t = useTranslations('modals');
  const tToasts = useTranslations('toasts');

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      const params = new URLSearchParams({ organizationId, policyId: String(policyId) });
      const res = await fetch(`/api/fleet-policy?${params}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? tToasts('imagesRemoveFailed'));
      }
      onRefresh();
      onOpenChange(false);
      toast.success(tToasts('imagesRemoved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tToasts('imagesRemoveFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isDeleting || nextOpen) onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('removeTitle')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('removeConfirm')}</p>
        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            {t('no')}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={isDeleting}>
            {isDeleting ? <Spinner size="sm" /> : t('yes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
