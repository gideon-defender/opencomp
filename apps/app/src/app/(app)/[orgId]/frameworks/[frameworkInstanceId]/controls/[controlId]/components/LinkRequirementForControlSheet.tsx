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

export function LinkRequirementForControlSheet({
  controlId,
  alreadyLinkedRequirementIds,
}: {
  controlId: string;
  alreadyLinkedRequirementIds: string[];
}) {
  const { hasPermission } = usePermissions();
  const t = useTranslations('frameworks');
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { requirements, isLoading } = useControlOptions(isOpen);
  const linked = useMemo(() => new Set(alreadyLinkedRequirementIds), [alreadyLinkedRequirementIds]);
  const options = useMemo(
    () => requirements.filter((r) => !linked.has(r.id)),
    [requirements, linked],
  );

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
    const mappings = options
      .filter((o) => selected.has(o.id))
      .map((o) =>
        o.isCustom
          ? {
              customRequirementId: o.id,
              frameworkInstanceId: o.frameworkInstanceId,
            }
          : {
              requirementId: o.id,
              frameworkInstanceId: o.frameworkInstanceId,
            },
      );
    setIsSubmitting(true);
    try {
      const response = await apiClient.post(`/v1/controls/${controlId}/requirements/link`, {
        requirements: mappings,
      });
      if (response.error) throw new Error(response.error);
      toast.success(t('controls.requirementsLinked'));
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('controls.failedToLinkRequirements'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button size="sm" iconLeft={<LinkIcon size={16} />} onClick={() => setIsOpen(true)}>
        {t('controls.linkRequirement')}
      </Button>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('controls.linkExistingRequirementsTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {isLoading ? (
              <Text size="sm" variant="muted">
                {t('controls.loadingRequirements')}
              </Text>
            ) : options.length === 0 ? (
              <Text size="sm" variant="muted">
                {t('controls.noAdditionalRequirements')}
              </Text>
            ) : (
              <div className="space-y-2">
                {options.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex items-start gap-3 rounded border p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.has(opt.id)}
                      onCheckedChange={() => toggle(opt.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">
                        {opt.identifier?.trim() ? `${opt.identifier} — ${opt.name}` : opt.name}
                      </div>
                      <Text size="xs" variant="muted">
                        {t('controls.requirementFrom', {
                          framework: opt.frameworkName,
                        })}
                      </Text>
                    </div>
                  </label>
                ))}
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSubmit} disabled={selected.size === 0 || isSubmitting}>
                    {t('controls.linkRequirementCount', {
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
