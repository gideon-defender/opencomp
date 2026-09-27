'use client';

import { useAdminTimelineTemplates } from '@/hooks/use-admin-timelines';
import { api } from '@/lib/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Stack,
  Text,
} from '@trycompai/design-system';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useTranslations } from 'next-intl';

export interface NewTemplateSchemaMessages {
  name: string;
  framework: string;
  cycle: string;
}

export function createNewTemplateSchema(messages: NewTemplateSchemaMessages) {
  return z.object({
    name: z.string().min(1, messages.name),
    frameworkId: z.string().min(1, messages.framework),
    cycleNumber: z.number().min(1, messages.cycle),
  });
}

interface Framework {
  id: string;
  name: string;
}

interface NewTemplateDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NewTemplateDialog({ open, onClose }: NewTemplateDialogProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const { mutate } = useAdminTimelineTemplates();
  const [saving, setSaving] = useState(false);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const t = useTranslations('admin');
  const tv = useTranslations('validation');

  const newTemplateSchema = useMemo(
    () =>
      createNewTemplateSchema({
        name: tv('templateNameRequired'),
        framework: tv('selectFrameworkRequired'),
        cycle: tv('cycleMin'),
      }),
    [tv],
  );

  type NewTemplateFormValues = z.infer<typeof newTemplateSchema>;

  useEffect(() => {
    if (!open) return;
    api.get<{ data: Framework[] }>('/v1/frameworks/available').then((res) => {
      if (res.data?.data) setFrameworks(res.data.data);
    });
  }, [open]);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<NewTemplateFormValues>({
    resolver: zodResolver(newTemplateSchema),
    defaultValues: { name: '', frameworkId: '', cycleNumber: 1 },
  });

  const handleCreate = async (values: NewTemplateFormValues) => {
    setSaving(true);
    const res = await api.post<{ id: string }>('/v1/admin/timeline-templates', values);
    setSaving(false);

    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success(t('timelineTemplates.editor.templateCreated'));
    reset();
    mutate();
    onClose();

    const created = res.data;
    if (created?.id) {
      router.push(`/${orgId}/admin/timeline-templates/${created.id}`);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('timelineTemplates.editor.newTemplate')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit(handleCreate)}>
            <Stack gap="md">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-name">{t('timelineTemplates.editor.templateNameLabel')}</Label>
                <Input
                  id="new-name"
                  {...register('name')}
                  placeholder={t('timelineTemplates.editor.newNamePlaceholder')}
                />
                {errors.name && (
                  <Text size="xs" variant="destructive">
                    {errors.name.message}
                  </Text>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>{t('timelineTemplates.editor.frameworkLabel')}</Label>
                <Controller
                  control={control}
                  name="frameworkId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t('timelineTemplates.editor.selectFramework')}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {frameworks.map((fw) => (
                          <SelectItem key={fw.id} value={fw.id}>
                            {fw.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.frameworkId && (
                  <Text size="xs" variant="destructive">
                    {errors.frameworkId.message}
                  </Text>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-cycleNumber">
                  {t('timelineTemplates.editor.cycleNumberLabel')}
                </Label>
                <Input
                  id="new-cycleNumber"
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

              <Button type="submit" loading={saving}>
                {t('timelineTemplates.editor.createTemplate')}
              </Button>
            </Stack>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
