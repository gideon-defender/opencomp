'use client';

import { useControls } from '@/app/(app)/[orgId]/controls/hooks/useControls';
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

export function LinkExistingControlSheet({
  frameworkInstanceId,
  requirementId,
  alreadyMappedControlIds,
  isCustomRequirement: _isCustomRequirement,
}: {
  frameworkInstanceId: string;
  requirementId: string;
  alreadyMappedControlIds: string[];
  isCustomRequirement?: boolean;
}) {
  const { hasPermission } = usePermissions();
  const { controls } = useControls();
  const router = useRouter();
  const t = useTranslations('frameworks');
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mappedSet = useMemo(() => new Set(alreadyMappedControlIds), [alreadyMappedControlIds]);
  const options = useMemo(
    () => controls.filter((c) => !mappedSet.has(c.id)),
    [controls, mappedSet],
  );

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) setSelected(new Set());
  }

  if (!hasPermission('framework', 'update')) return null;

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
        `/v1/frameworks/${frameworkInstanceId}/requirements/${requirementId}/controls/link`,
        { controlIds: Array.from(selected) },
      );
      if (response.error) throw new Error(response.error);
      toast.success(t('requirements.controlsLinked'));
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('requirements.controlsLinkFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button size="sm" iconLeft={<LinkIcon size={16} />} onClick={() => setIsOpen(true)}>
        {t('requirements.linkControlButton')}
      </Button>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('requirements.linkExistingTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {options.length === 0 ? (
              <Text size="sm" variant="muted">
                {t('requirements.noAdditionalControls')}
              </Text>
            ) : (
              <div className="space-y-2">
                {options.map((control) => (
                  <label
                    key={control.id}
                    className="flex items-start gap-3 rounded border p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.has(control.id)}
                      onCheckedChange={() => toggle(control.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{control.name}</div>
                      {control.description ? (
                        <Text size="xs" variant="muted">
                          {control.description}
                        </Text>
                      ) : null}
                    </div>
                  </label>
                ))}
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSubmit} disabled={selected.size === 0 || isSubmitting}>
                    {t('requirements.linkCount', { count: selected.size })}
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
