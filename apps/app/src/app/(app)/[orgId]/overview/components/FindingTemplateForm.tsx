'use client';

import type { CreateFindingTemplateData } from '@/hooks/use-findings-api';
import { Button } from '@gideon-defender/ui/button';
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
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CATEGORY_LABEL_KEYS, TEMPLATE_CATEGORIES } from './finding-template-categories';

export interface FindingTemplateFormProps {
  initialValues?: CreateFindingTemplateData;
  submitLabel: string;
  isSubmitting: boolean;
  onSubmit: (values: CreateFindingTemplateData) => Promise<void>;
  onCancel: () => void;
}

export function FindingTemplateForm({
  initialValues,
  submitLabel,
  isSubmitting,
  onSubmit,
  onCancel,
}: FindingTemplateFormProps) {
  const t = useTranslations('overview');

  const templateSchema = useMemo(
    () =>
      z.object({
        category: z.string().min(1, t('findings.templateCategoryRequired')),
        title: z.string().min(1, t('findings.templateTitleRequired')).max(500),
        content: z.string().min(1, t('findings.templateContentRequired')).max(50000),
        order: z.coerce.number().int().min(0).default(0),
      }),
    [t],
  );

  type TemplateFormInput = z.input<typeof templateSchema>;
  type TemplateFormOutput = z.output<typeof templateSchema>;

  const form = useForm<TemplateFormInput>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      category: initialValues?.category ?? '',
      title: initialValues?.title ?? '',
      content: initialValues?.content ?? '',
      order: initialValues?.order ?? 0,
    },
  });

  const handleValidSubmit = (values: TemplateFormInput) => onSubmit(values as TemplateFormOutput);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleValidSubmit)} className="w-full space-y-4">
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('findings.templateCategory')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t('findings.templateCategoryPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {t(CATEGORY_LABEL_KEYS[category])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('findings.templateTitle')}</FormLabel>
              <FormControl>
                <Input placeholder={t('findings.templateTitlePlaceholder')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('findings.templateContent')}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={t('findings.templateContentPlaceholder')}
                  rows={5}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="order"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('findings.templateOrder')}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={(field.value as number | string | undefined) ?? 0}
                  onChange={(e) =>
                    field.onChange(e.target.value === '' ? 0 : e.target.valueAsNumber)
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
