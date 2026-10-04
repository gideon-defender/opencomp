'use client';

import { apiClient } from '@/app/lib/api-client';
import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@gideon-defender/ui/form';
import { Input } from '@gideon-defender/ui/input';
import { Textarea } from '@gideon-defender/ui/textarea';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { createFrameworkBaseSchema } from '../schemas';

interface CreateFrameworkDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onFrameworkCreated?: () => void;
}

export function CreateFrameworkDialog({
  isOpen,
  onOpenChange,
  onFrameworkCreated,
}: CreateFrameworkDialogProps) {
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
      name: '',
      description: '',
      version: '1.0.0',
      visible: true,
    },
    mode: 'onChange',
  });

  async function onSubmit(values: FrameworkFormValues) {
    try {
      await apiClient('/framework', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          description: values.description,
          version: values.version,
          visible: values.visible,
        }),
      });
      toast.success(tToasts('frameworkCreated'));
      onOpenChange(false);
      form.reset();
      onFrameworkCreated?.();
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : tToasts('frameworkCreateFailed');
      toast.error(message);
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          form.reset();
        }
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createFramework.title')}</DialogTitle>
          <DialogDescription>{t('createFramework.description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-2 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-2">
                  <FormLabel className="text-right">{t('createFramework.nameLabel')}</FormLabel>
                  <FormControl className="col-span-3">
                    <Input placeholder={t('createFramework.namePlaceholder')} {...field} />
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
                    {t('createFramework.descriptionLabel')}
                  </FormLabel>
                  <FormControl className="col-span-3">
                    <Textarea
                      placeholder={t('createFramework.descriptionPlaceholder')}
                      {...field}
                    />
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
                  <FormLabel className="text-right">{t('createFramework.versionLabel')}</FormLabel>
                  <FormControl className="col-span-3">
                    <Input placeholder={t('createFramework.versionPlaceholder')} {...field} />
                  </FormControl>
                  <div className="col-span-3 col-start-2">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                  }}
                >
                  {t('createFramework.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? t('createFramework.submitting')
                  : t('createFramework.submit')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
