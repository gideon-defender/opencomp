'use client';

import {
  useFindingTemplateActions,
  useFindingTemplates,
  type CreateFindingTemplateData,
  type FindingTemplate,
} from '@/hooks/use-findings-api';
import { Button } from '@gideon-defender/ui/button';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@gideon-defender/ui/sheet';
import { Skeleton } from '@gideon-defender/ui/skeleton';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FindingTemplateDeleteDialog } from './FindingTemplateDeleteDialog';
import { FindingTemplateForm } from './FindingTemplateForm';
import { FindingTemplateTable } from './FindingTemplateTable';

interface FindingTemplateManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FindingTemplateManager({ open, onOpenChange }: FindingTemplateManagerProps) {
  const t = useTranslations('overview');
  const { data: templatesData, isLoading } = useFindingTemplates();
  const { createTemplate, updateTemplate, deleteTemplate } = useFindingTemplateActions();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FindingTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FindingTemplate | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const templates: FindingTemplate[] = useMemo(
    () => (Array.isArray(templatesData?.data) ? templatesData.data : []),
    [templatesData],
  );

  // Org templates sort before globals so the editable rows come first.
  // Server order (category, order, title) is preserved within each group.
  const scopedTemplates = useMemo(
    () => [
      ...templates.filter((tpl) => tpl.organizationId !== null),
      ...templates.filter((tpl) => tpl.organizationId === null),
    ],
    [templates],
  );

  const handleStartCreate = () => {
    setEditing(null);
    setShowForm(true);
  };

  const handleStartEdit = (template: FindingTemplate) => {
    setEditing(template);
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleSubmit = async (values: CreateFindingTemplateData) => {
    setIsSubmitting(true);
    try {
      if (editing) {
        await updateTemplate(editing.id, values);
        toast.success(t('findings.templateUpdateSuccess'));
      } else {
        await createTemplate(values);
        toast.success(t('findings.templateCreateSuccess'));
      }
      handleCancelForm();
    } catch {
      toast.error(t('findings.templateSaveError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsSubmitting(true);
    try {
      await deleteTemplate(deleteTarget.id);
      toast.success(t('findings.templateDeleteSuccess'));
      setDeleteTarget(null);
    } catch {
      toast.error(t('findings.templateDeleteError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('findings.manageTemplates')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="flex w-full flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <p className="text-sm text-muted-foreground md:flex-1">
                {t('findings.manageTemplatesDescription')}
              </p>
              {!showForm && (
                <Button type="button" variant="outline" size="sm" onClick={handleStartCreate}>
                  <Plus className="h-4 w-4" />
                  <span className="ml-1">{t('findings.newTemplate')}</span>
                </Button>
              )}
            </div>
            {isLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : showForm ? (
              <FindingTemplateForm
                key={editing?.id ?? 'new'}
                initialValues={
                  editing
                    ? {
                        category: editing.category,
                        title: editing.title,
                        content: editing.content,
                        order: editing.order,
                      }
                    : undefined
                }
                submitLabel={editing ? t('findings.saveTemplate') : t('findings.createTemplate')}
                isSubmitting={isSubmitting}
                onSubmit={handleSubmit}
                onCancel={handleCancelForm}
              />
            ) : (
              <FindingTemplateTable
                templates={scopedTemplates}
                isDeleting={isSubmitting}
                onEdit={handleStartEdit}
                onDelete={setDeleteTarget}
              />
            )}
          </div>
        </SheetBody>
      </SheetContent>
      <FindingTemplateDeleteDialog
        template={deleteTarget}
        isDeleting={isSubmitting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </Sheet>
  );
}
