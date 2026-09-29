'use client';

import { useFrameworks } from '@/hooks/use-frameworks';
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
import useSWR from 'swr';

interface RequirementOption {
  id: string;
  name: string;
  identifier: string;
  frameworkName: string;
}

export function LinkRequirementSheet({ frameworkInstanceId }: { frameworkInstanceId: string }) {
  const { hasPermission } = usePermissions();
  const t = useTranslations('frameworks');
  const router = useRouter();
  const { frameworks } = useFrameworks();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const otherFrameworkIds = useMemo(
    () => frameworks.filter((f) => f.id !== frameworkInstanceId).map((f) => f.id),
    [frameworks, frameworkInstanceId],
  );

  const { data: options = [], isLoading } = useSWR<RequirementOption[]>(
    isOpen && otherFrameworkIds.length > 0
      ? ['link-requirements-options', ...otherFrameworkIds]
      : null,
    async () => {
      const responses = await Promise.all(
        otherFrameworkIds.map((id) =>
          apiClient.get<{
            framework: { name: string };
            requirementDefinitions: {
              id: string;
              name: string;
              identifier: string;
            }[];
          }>(`/v1/frameworks/${id}`),
        ),
      );
      const opts: RequirementOption[] = [];
      for (const resp of responses) {
        if (!resp.data) continue;
        const fwName = resp.data.framework?.name ?? t('instance.framework');
        for (const req of resp.data.requirementDefinitions ?? []) {
          opts.push({
            id: req.id,
            name: req.name,
            identifier: req.identifier,
            frameworkName: fwName,
          });
        }
      }
      return opts;
    },
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
        `/v1/frameworks/${frameworkInstanceId}/requirements/link`,
        { requirementIds: Array.from(selected) },
      );
      if (response.error) throw new Error(response.error);
      toast.success(t('instance.requirementsLinkedToast'));
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('instance.linkRequirementsFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button size="sm" iconLeft={<LinkIcon size={16} />} onClick={() => setIsOpen(true)}>
        {t('instance.linkRequirementButton')}
      </Button>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('instance.linkExistingRequirementsTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {isLoading ? (
              <Text size="sm" variant="muted">
                {t('instance.loadingRequirements')}
              </Text>
            ) : options.length === 0 ? (
              <Text size="sm" variant="muted">
                {t('instance.noRequirementsAvailable')}
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
                        {t('instance.fromFramework', {
                          frameworkName: opt.frameworkName,
                        })}
                      </Text>
                    </div>
                  </label>
                ))}
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSubmit} disabled={selected.size === 0 || isSubmitting}>
                    {t('instance.linkRequirementSubmit', { count: selected.size })}
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
