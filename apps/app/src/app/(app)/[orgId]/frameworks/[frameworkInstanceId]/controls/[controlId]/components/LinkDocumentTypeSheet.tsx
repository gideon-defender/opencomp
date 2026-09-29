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
import { ALL_DOCUMENT_TYPES, getDocumentTypeLabel } from './documentTypeLabels';

export function LinkDocumentTypeSheet({
  controlId,
  frameworkInstanceId,
  alreadyLinkedFormTypes,
}: {
  controlId: string;
  frameworkInstanceId: string;
  alreadyLinkedFormTypes: string[];
}) {
  const { hasPermission } = usePermissions();
  const t = useTranslations('frameworks');
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const linked = useMemo(() => new Set(alreadyLinkedFormTypes), [alreadyLinkedFormTypes]);
  const options = useMemo(() => ALL_DOCUMENT_TYPES.filter((t) => !linked.has(t)), [linked]);

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
    setIsSubmitting(true);
    try {
      const response = await apiClient.post(
        `/v1/controls/${controlId}/document-types/link?frameworkInstanceId=${frameworkInstanceId}`,
        { formTypes: Array.from(selected) },
      );
      if (response.error) throw new Error(response.error);
      toast.success(t('controls.documentsLinked'));
      setIsOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('controls.failedToLinkDocuments'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button size="sm" iconLeft={<LinkIcon size={16} />} onClick={() => setIsOpen(true)}>
        {t('controls.linkDocument')}
      </Button>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('controls.linkRequiredDocumentsTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {options.length === 0 ? (
              <Text size="sm" variant="muted">
                {t('controls.allDocumentTypesLinked')}
              </Text>
            ) : (
              <div className="space-y-2">
                {options.map((formType) => (
                  <label
                    key={formType}
                    className="flex items-start gap-3 rounded border p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.has(formType)}
                      onCheckedChange={() => toggle(formType)}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm">{getDocumentTypeLabel(formType)}</div>
                    </div>
                  </label>
                ))}
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSubmit} disabled={selected.size === 0 || isSubmitting}>
                    {t('controls.linkDocumentCount', {
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
