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
  DialogTrigger,
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
import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useSecrets } from '../hooks/useSecrets';

type SettingsTranslator = ReturnType<typeof useTranslations<'settings'>>;

function createSecretSchema(t: SettingsTranslator) {
  return z.object({
    name: z
      .string()
      .min(1, t('secrets.errors.nameRequired'))
      .max(100, t('secrets.errors.nameTooLong'))
      .regex(/^[A-Z0-9_]+$/, t('secrets.errors.nameFormat')),
    value: z.string().min(1, t('secrets.errors.valueRequired')),
    description: z.string().optional(),
    category: z.string().optional(),
  });
}

type SecretFormValues = z.infer<ReturnType<typeof createSecretSchema>>;

export function AddSecretDialog() {
  const t = useTranslations('settings');
  const [open, setOpen] = useState(false);
  const { createSecret } = useSecrets();
  const { hasPermission } = usePermissions();
  const canManageSecrets = hasPermission('secret', 'create');

  const secretSchema = useMemo(() => createSecretSchema(t), [t]);

  const {
    handleSubmit,
    control,
    register,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SecretFormValues>({
    resolver: zodResolver(secretSchema),
    defaultValues: { name: '', value: '', description: '', category: '' },
    mode: 'onChange',
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createSecret({
        name: values.name,
        value: values.value,
        description: values.description || null,
        category: values.category || null,
      });

      toast.success(t('secrets.addDialog.successToast'));
      setOpen(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('secrets.addDialog.failedToast'));
      console.error('Error creating secret:', err);
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="mr-2 h-4 w-4" />
          {t('secrets.addDialog.addButton')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t('secrets.addDialog.title')}</DialogTitle>
            <DialogDescription>{t('secrets.addDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{t('secrets.addDialog.nameLabel')}</Label>
              <Input
                id="name"
                placeholder="e.g., GITHUB_TOKEN, GOOGLE_GENERATIVE_AI_API_KEY"
                {...register('name')}
              />
              {errors.name?.message ? (
                <p className="text-xs text-destructive mt-1">{errors.name.message}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{t('secrets.addDialog.namingHint')}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="value">{t('secrets.addDialog.valueLabel')}</Label>
              <Input
                id="value"
                type="password"
                placeholder={t('secrets.addDialog.valuePlaceholder')}
                {...register('value')}
              />
              {errors.value?.message ? (
                <p className="text-xs text-destructive mt-1">{errors.value.message}</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="category">{t('secrets.addDialog.categoryLabel')}</Label>
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="category">
                      <SelectValue placeholder={t('secrets.addDialog.categoryPlaceholder')} />
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
              <Label htmlFor="description">{t('secrets.addDialog.descriptionLabel')}</Label>
              <Textarea
                id="description"
                placeholder={t('secrets.addDialog.descriptionPlaceholder')}
                rows={3}
                {...register('description')}
              />
              {errors.description?.message ? (
                <p className="text-xs text-destructive mt-1">{errors.description.message}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('secrets.addDialog.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !canManageSecrets}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('secrets.addDialog.submitting')}
                </>
              ) : (
                t('secrets.addDialog.submit')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
