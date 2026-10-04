'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import { Input } from '@gideon-defender/ui/input';
import { Label } from '@gideon-defender/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui/select';
import { Textarea } from '@gideon-defender/ui/textarea';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useSecrets } from '../hooks/useSecrets';

interface EditSecretDialogProps {
  secret: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTranslator = ReturnType<typeof useTranslations<'settings'>>;

function createEditSecretSchema(t: SettingsTranslator) {
  return z.object({
    name: z
      .string()
      .min(1, t('secrets.errors.nameRequired'))
      .max(100, t('secrets.errors.nameTooLong'))
      .regex(/^[A-Z0-9_]+$/, t('secrets.errors.nameFormat')),
    value: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
  });
}

type EditSecretFormValues = z.infer<ReturnType<typeof createEditSecretSchema>>;

export function EditSecretDialog({ secret, open, onOpenChange }: EditSecretDialogProps) {
  const t = useTranslations('settings');
  const { updateSecret } = useSecrets();
  const { hasPermission } = usePermissions();
  const canManageSecrets = hasPermission('secret', 'update');

  const editSecretSchema = useMemo(() => createEditSecretSchema(t), [t]);

  const {
    handleSubmit,
    control,
    register,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditSecretFormValues>({
    resolver: zodResolver(editSecretSchema),
    defaultValues: {
      name: secret.name,
      value: '',
      description: secret.description || '',
      category: secret.category || '',
    },
    mode: 'onChange',
  });

  // Reset form when secret changes
  useEffect(() => {
    reset({
      name: secret.name,
      value: '',
      description: secret.description || '',
      category: secret.category || '',
    });
  }, [secret, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      // Only send fields that have values
      const updateData: Record<string, string | null> = {};
      if (values.name !== secret.name) updateData.name = values.name;
      if (values.value) updateData.value = values.value;
      if (values.description !== secret.description)
        updateData.description = values.description || null;
      if (values.category !== secret.category) updateData.category = values.category || null;

      await updateSecret(secret.id, updateData);

      toast.success(t('secrets.editDialog.successToast'));
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('secrets.editDialog.failedToast'));
      console.error('Error updating secret:', err);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t('secrets.editDialog.title')}</DialogTitle>
            <DialogDescription>{t('secrets.editDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">{t('secrets.editDialog.nameLabel')}</Label>
              <Input
                id="edit-name"
                placeholder="e.g., GITHUB_TOKEN, GOOGLE_GENERATIVE_AI_API_KEY"
                {...register('name')}
              />
              {errors.name?.message ? (
                <p className="text-xs text-destructive mt-1">{errors.name.message}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{t('secrets.editDialog.namingHint')}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-value">{t('secrets.editDialog.valueLabel')}</Label>
              <Input
                id="edit-value"
                type="password"
                placeholder={t('secrets.editDialog.valuePlaceholder')}
                {...register('value')}
              />
              {errors.value?.message ? (
                <p className="text-xs text-destructive mt-1">{errors.value.message}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{t('secrets.editDialog.valueHint')}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-category">{t('secrets.editDialog.categoryLabel')}</Label>
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="edit-category">
                      <SelectValue placeholder={t('secrets.editDialog.categoryPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="api_keys">{t('secrets.categories.api_keys')}</SelectItem>
                      <SelectItem value="database">{t('secrets.categories.database')}</SelectItem>
                      <SelectItem value="authentication">
                        {t('secrets.categories.authentication')}
                      </SelectItem>
                      <SelectItem value="integration">
                        {t('secrets.categories.integration')}
                      </SelectItem>
                      <SelectItem value="other">{t('secrets.categories.other')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.category?.message ? (
                <p className="text-xs text-destructive mt-1">{errors.category.message}</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">{t('secrets.editDialog.descriptionLabel')}</Label>
              <Textarea
                id="edit-description"
                placeholder={t('secrets.editDialog.descriptionPlaceholder')}
                rows={3}
                {...register('description')}
              />
              {errors.description?.message ? (
                <p className="text-xs text-destructive mt-1">{errors.description.message}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('secrets.editDialog.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !canManageSecrets}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('secrets.editDialog.submitting')}
                </>
              ) : (
                t('secrets.editDialog.submit')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
