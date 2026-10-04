'use client';

import { apiClient } from '@/app/lib/api-client';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
  Textarea,
} from '@gideon-defender/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { createFrameworkBaseSchema } from '../../schemas';

interface FrameworkData {
  id: string;
  name: string;
  description: string;
  version: string;
  visible: boolean;
}

interface EditFrameworkDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  framework: FrameworkData;
  onFrameworkUpdated?: (updatedData: FrameworkData) => void;
}

export function EditFrameworkDialog({
  isOpen,
  onOpenChange,
  framework,
  onFrameworkUpdated,
}: EditFrameworkDialogProps) {
  const router = useRouter();
  const t = useTranslations('dialogs');
  const tToasts = useTranslations('toasts');
  const tValidation = useTranslations('validation');

  const schema = useMemo(
    () =>
      createFrameworkBaseSchema({
        nameRequired: tValidation('nameRequired'),
        descriptionRequired: tValidation('descriptionRequired'),
        versionRequired: tValidation('versionRequired'),
        requirementNameRequired: tValidation('requirementNameRequired'),
      }),
    [tValidation],
  );

  type FrameworkFormValues = z.infer<typeof schema>;

  const form = useForm<FrameworkFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: framework.name,
      description: framework.description,
      version: framework.version,
      visible: framework.visible,
    },
    mode: 'onChange',
  });

  useEffect(() => {
    form.reset({
      name: framework.name,
      description: framework.description,
      version: framework.version,
      visible: framework.visible,
    });
  }, [framework, form]);

  async function onSubmit(values: FrameworkFormValues) {
    try {
      const updatedFramework = await apiClient<FrameworkData>(`/framework/${framework.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: values.name,
          description: values.description,
          version: values.version,
          visible: values.visible,
        }),
      });
      toast.success(tToasts('frameworkUpdated'));
      onOpenChange(false);
      onFrameworkUpdated?.(updatedFramework);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : tToasts('frameworkUpdateFailed');
      toast.error(message);
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          form.reset({
            name: framework.name,
            description: framework.description,
            version: framework.version,
            visible: framework.visible,
          });
        }
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editFramework.title')}</DialogTitle>
          <DialogDescription>{t('editFramework.description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-2">
                  <FormLabel className="text-right">{t('editFramework.nameLabel')}</FormLabel>
                  <FormControl className="col-span-3">
                    <Input placeholder={t('editFramework.namePlaceholder')} {...field} />
                  </FormControl>
                  <div className="col-span-3 col-start-2">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-2">
                  <FormLabel className="text-right">
                    {t('editFramework.descriptionLabel')}
                  </FormLabel>
                  <FormControl className="col-span-3">
                    <Textarea placeholder={t('editFramework.descriptionPlaceholder')} {...field} />
                  </FormControl>
                  <div className="col-span-3 col-start-2">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="version"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-2">
                  <FormLabel className="text-right">{t('editFramework.versionLabel')}</FormLabel>
                  <FormControl className="col-span-3">
                    <Input placeholder={t('editFramework.versionPlaceholder')} {...field} />
                  </FormControl>
                  <div className="col-span-3 col-start-2">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="visible"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-2">
                  <FormLabel className="text-right">{t('editFramework.visibleLabel')}</FormLabel>
                  <FormControl className="col-span-3">
                    <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="col-span-3 col-start-2">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('editFramework.cancel')}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting || !form.formState.isDirty}
              >
                {form.formState.isSubmitting
                  ? t('editFramework.saving')
                  : t('editFramework.saveChanges')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
