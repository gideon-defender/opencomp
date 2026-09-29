'use client';

import type { AdminTimelineTemplate } from '@/hooks/use-admin-timelines';
import { api } from '@/lib/api-client';
import { Input } from '@gideon-defender/ui/input';
import { Label } from '@gideon-defender/ui/label';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Stack,
  Text,
} from '@trycompai/design-system';
import { Add, TrashCan } from '@trycompai/design-system/icons';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { PhaseRow } from './PhaseRow';
import { createNewTemplate, getDefaults, saveExistingTemplate } from './template-actions';

export interface TemplateSchemaMessages {
  phaseName: string;
  durationMin: string;
  templateName: string;
  frameworkId: string;
  cycle: string;
}

export function createTemplateSchema(messages: TemplateSchemaMessages) {
  const phaseSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1, messages.phaseName),
    description: z.string().optional(),
    defaultDurationWeeks: z.number().min(1, messages.durationMin),
    completionType: z.enum([
      'AUTO_TASKS',
      'AUTO_POLICIES',
      'AUTO_PEOPLE',
      'AUTO_FINDINGS',
      'AUTO_UPLOAD',
      'MANUAL',
    ]),
    locksTimelineOnComplete: z.boolean().optional(),
  });

  return z.object({
    name: z.string().min(1, messages.templateName),
    frameworkId: z.string().min(1, messages.frameworkId),
    cycleNumber: z.number().min(1, messages.cycle),
    phases: z.array(phaseSchema),
  });
}

interface TemplateEditorProps {
  open: boolean;
  onClose: () => void;
  template: AdminTimelineTemplate | null;
  onMutate: () => void;
}

export function TemplateEditor({ open, onClose, template, onMutate }: TemplateEditorProps) {
  const isEditing = !!template;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const t = useTranslations('admin');
  const tv = useTranslations('validation');
  const tt = useTranslations('toasts');

  const templateSchema = useMemo(
    () =>
      createTemplateSchema({
        phaseName: tv('nameRequired'),
        durationMin: tv('durationMinWeeks'),
        templateName: tv('templateNameRequired'),
        frameworkId: tv('frameworkIdRequired'),
        cycle: tv('cycleMin'),
      }),
    [tv],
  );

  type TemplateFormValues = z.infer<typeof templateSchema>;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: getDefaults(template),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'phases',
  });

  useEffect(() => {
    reset(getDefaults(template));
  }, [template, reset]);

  const handleSave = async (values: TemplateFormValues) => {
    setSaving(true);
    try {
      if (isEditing) {
        await saveExistingTemplate(template, values);
        toast.success(t('timelineTemplates.editor.templateUpdated'));
      } else {
        await createNewTemplate(values);
        toast.success(t('timelineTemplates.editor.templateCreated'));
      }
      onMutate();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tt('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!template) return;
    setDeleting(true);
    const res = await api.delete(`/v1/admin/timeline-templates/${template.id}`);
    setDeleting(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(tt('templateDeleted'));
    onMutate();
    onClose();
  };

  const handleAddPhase = () => {
    append({
      name: '',
      description: '',
      defaultDurationWeeks: 2,
      completionType: 'MANUAL',
      locksTimelineOnComplete: false,
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {isEditing
              ? t('timelineTemplates.editor.editTemplate')
              : t('timelineTemplates.editor.newTemplate')}
          </SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit(handleSave)}>
            <Stack gap="md">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">{t('timelineTemplates.editor.templateNameLabel')}</Label>
                <Input
                  id="name"
                  {...register('name')}
                  placeholder={t('timelineTemplates.editor.namePlaceholder')}
                />
                {errors.name && (
                  <Text size="xs" variant="destructive">
                    {errors.name.message}
                  </Text>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="frameworkId">
                  {t('timelineTemplates.editor.frameworkIdLabel')}
                </Label>
                <Input
                  id="frameworkId"
                  {...register('frameworkId')}
                  disabled={isEditing}
                  placeholder={t('timelineTemplates.editor.frameworkIdPlaceholder')}
                />
                {errors.frameworkId && (
                  <Text size="xs" variant="destructive">
                    {errors.frameworkId.message}
                  </Text>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cycleNumber">
                  {t('timelineTemplates.editor.cycleNumberLabel')}
                </Label>
                <Input
                  id="cycleNumber"
                  type="number"
                  min={1}
                  {...register('cycleNumber', { valueAsNumber: true })}
                />
                {errors.cycleNumber && (
                  <Text size="xs" variant="destructive">
                    {errors.cycleNumber.message}
                  </Text>
                )}
              </div>

              <div className="flex items-center justify-between">
                  <Text size="sm" weight="semibold">
                    {t('timelineTemplates.editor.phases')}
                  </Text>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  iconLeft={<Add size={16} />}
                  onClick={handleAddPhase}
                >
                  {t('timelineTemplates.editor.addPhase')}
                </Button>
              </div>

              {fields.length === 0 && (
                <div className="rounded-lg border border-dashed py-4 text-center text-sm text-muted-foreground">
                  {t('timelineTemplates.editor.noPhasesYet')}
                </div>
              )}

              {fields.map((field, index) => (
                <PhaseRow
                  key={field.id}
                  index={index}
                  register={register}
                  errors={errors}
                  onRemove={() => remove(index)}
                />
              ))}

              <div className="flex items-center gap-2 pt-4">
                <Button type="submit" loading={saving}>
                  {isEditing
                    ? t('timelineTemplates.editor.saveChanges')
                    : t('timelineTemplates.editor.createTemplate')}
                </Button>
                {isEditing && (
                  <Button
                    type="button"
                    variant="destructive"
                    iconLeft={<TrashCan size={16} />}
                    loading={deleting}
                    onClick={handleDelete}
                  >
                    {t('timelineTemplates.editor.delete')}
                  </Button>
                )}
              </div>
            </Stack>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
