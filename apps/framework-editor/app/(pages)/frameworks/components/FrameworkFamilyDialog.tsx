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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui/select';
import { Textarea } from '@gideon-defender/ui/textarea';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import type { FrameworkFamilyWithCount } from '../FrameworksClientPage';
import { createFrameworkFamilyBaseSchema } from '../schemas';
import { FRAMEWORK_FAMILY_STATUSES } from './family-status';

// Stops password managers (NordPass, 1Password, LastPass, Dashlane, Bitwarden)
// from popping autofill widgets over these non-credential fields.
const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-form-type': 'other',
  'data-bwignore': true,
} as const;

interface FrameworkFamilyDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  // When provided, the dialog edits this family; otherwise it creates a new one.
  family?: FrameworkFamilyWithCount | null;
}

export function FrameworkFamilyDialog({
  isOpen,
  onOpenChange,
  family,
}: FrameworkFamilyDialogProps) {
  const router = useRouter();
  const isEdit = Boolean(family);
  const t = useTranslations('dialogs');
  const tFrameworks = useTranslations('frameworks');
  const tToasts = useTranslations('toasts');
  const tValidation = useTranslations('validation');

  const schema = useMemo(
    () =>
      createFrameworkFamilyBaseSchema({
        nameRequired: tValidation('nameRequired'),
        descriptionRequired: tValidation('descriptionRequired'),
        versionRequired: tValidation('versionRequired'),
        requirementNameRequired: tValidation('requirementNameRequired'),
      }),
    [tValidation],
  );

  type FamilyFormValues = z.infer<typeof schema>;

  const form = useForm<FamilyFormValues>({    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', status: 'hidden' },
    mode: 'onChange',
  });

  // Prefill on open (and when the target family changes).
  useEffect(() => {
    if (isOpen) {
      form.reset({
        name: family?.name ?? '',
        description: family?.description ?? '',
        status: family?.status ?? 'hidden',
      });
    }
  }, [isOpen, family, form]);

  async function onSubmit(values: FamilyFormValues) {
    try {
      if (isEdit && family) {
        await apiClient(`/framework-family/${family.id}`, {
          method: 'PATCH',
          body: JSON.stringify(values),
        });
        toast.success(tToasts('familyUpdated'));
      } else {
        await apiClient('/framework-family', {
          method: 'POST',
          body: JSON.stringify(values),
        });
        toast.success(tToasts('familyCreated'));
      }
      onOpenChange(false);
      form.reset();
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : tToasts('familySaveFailed');
      toast.error(message);
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) form.reset();
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('familyDialog.editTitle') : t('familyDialog.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t('familyDialog.editDescription') : t('familyDialog.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-2 py-4"
            autoComplete="off"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-2">
                  <FormLabel className="text-right">{t('familyDialog.nameLabel')}</FormLabel>
                  <FormControl className="col-span-3">
                    <Input
                      placeholder={t('familyDialog.nameExamplePlaceholder')}
                      {...NO_AUTOFILL}
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
              name="description"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-2">
                  <FormLabel className="text-right">{t('familyDialog.descriptionLabel')}</FormLabel>
                  <FormControl className="col-span-3">
                    <Textarea
                      placeholder={t('familyDialog.descriptionHintPlaceholder')}
                      {...NO_AUTOFILL}
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
              name="status"
              render={({ field }) => (
                <FormItem className="grid grid-cols-4 items-center gap-2">
                  <FormLabel className="text-right">{t('familyDialog.statusLabel')}</FormLabel>
                  <FormControl className="col-span-3">
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('familyDialog.selectStatus')} />
                      </SelectTrigger>
                      <SelectContent>
                        {FRAMEWORK_FAMILY_STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.value === 'visible'
                              ? tFrameworks('status.visible')
                              : s.value === 'hidden'
                                ? tFrameworks('status.hidden')
                                : s.value === 'partial'
                                  ? tFrameworks('status.partial')
                                  : tFrameworks('status.underConstruction')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <div className="col-span-3 col-start-2">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t('familyDialog.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? t('familyDialog.saving')
                  : isEdit
                    ? t('familyDialog.save')
                    : t('familyDialog.create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
