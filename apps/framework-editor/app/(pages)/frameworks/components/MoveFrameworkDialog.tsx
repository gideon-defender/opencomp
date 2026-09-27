'use client';

import { apiClient } from '@/app/lib/api-client';
import { Button } from '@gideon-defender/ui/button';
import { Checkbox } from '@gideon-defender/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui/select';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { FrameworkFamilyWithCount, FrameworkWithCounts } from '../FrameworksClientPage';

// Sentinel for "move to the root" (Select can't hold a null value).
const ROOT_VALUE = '__root__';

interface MoveFrameworkDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  frameworks: FrameworkWithCounts[];
  families: FrameworkFamilyWithCount[];
}

export function MoveFrameworkDialog({
  isOpen,
  onOpenChange,
  frameworks,
  families,
}: MoveFrameworkDialogProps) {
  const router = useRouter();
  const t = useTranslations('dialogs');
  const tToasts = useTranslations('toasts');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState<string>(ROOT_VALUE);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelected(new Set());
      setDestination(ROOT_VALUE);
    }
  }, [isOpen]);

  const familyNameById = useMemo(() => new Map(families.map((f) => [f.id, f.name])), [families]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function handleMove() {
    if (selected.size === 0) {
      toast.error(tToasts('moveSelectAtLeastOne'));
      return;
    }
    setIsSubmitting(true);
    try {
      await apiClient('/framework-family/move', {
        method: 'POST',
        body: JSON.stringify({
          frameworkIds: [...selected],
          familyId: destination === ROOT_VALUE ? null : destination,
        }),
      });
      toast.success(tToasts('frameworksMoved', { count: selected.size }));
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tToasts('moveFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('moveFramework.title')}</DialogTitle>
          <DialogDescription>{t('moveFramework.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <p className="mb-2 text-sm font-medium">{t('moveFramework.frameworksLabel')}</p>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {frameworks.length === 0 ? (
                <p className="text-muted-foreground p-3 text-sm">
                  {t('moveFramework.noFrameworks')}
                </p>
              ) : (
                frameworks.map((fw) => (
                  <label
                    key={fw.id}
                    className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 border-b px-3 py-2 last:border-0"
                  >
                    <Checkbox checked={selected.has(fw.id)} onCheckedChange={() => toggle(fw.id)} />
                    <span className="text-sm">{fw.name}</span>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {fw.familyId
                        ? (familyNameById.get(fw.familyId) ?? t('moveFramework.unknownFamily'))
                        : '/'}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{t('moveFramework.destinationLabel')}</p>
            <Select value={destination} onValueChange={setDestination}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_VALUE}>{t('moveFramework.rootLabel')}</SelectItem>
                {families.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('moveFramework.cancel')}
          </Button>
          <Button onClick={handleMove} disabled={isSubmitting || selected.size === 0}>
            {isSubmitting ? t('moveFramework.moving') : t('moveFramework.move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
