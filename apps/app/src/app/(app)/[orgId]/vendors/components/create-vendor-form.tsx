'use client';

import { SelectAssignee } from '@/components/SelectAssignee';
import { useVendorActions } from '@/hooks/use-vendors';
import { type Member, type User, VendorCategory, VendorStatus } from '@db';
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
import { ArrowRightIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';
import { z } from 'zod';
import { VendorNameAutocompleteField } from './VendorNameAutocompleteField';

export function CreateVendorForm({
  assignees,
  organizationId,
  onSuccess,
}: {
  assignees: (Member & { user: User })[];
  organizationId: string;
  onSuccess?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const { createVendor } = useVendorActions();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const t = useTranslations('vendor');
  const tCommon = useTranslations('overview');

  const pendingWebsiteRef = useRef<string | null>(null);

  const createVendorSchema = z.object({
    name: z.string().trim().min(1, t('create.nameRequired')),
    website: z
      .union([z.string().url(t('create.urlInvalidCreate')), z.literal('')])
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
    description: z.string().optional(),
    category: z.nativeEnum(VendorCategory),
    status: z.nativeEnum(VendorStatus),
    assigneeId: z.string().optional(),
  });

  type CreateVendorFormValues = z.infer<typeof createVendorSchema>;

  const form = useForm<CreateVendorFormValues>({
    resolver: zodResolver(createVendorSchema),
    defaultValues: {
      name: '',
      website: '',
      description: '',
      category: VendorCategory.cloud,
      status: VendorStatus.not_assessed,
    },
    mode: 'onChange',
  });

  const onSubmit = async (data: CreateVendorFormValues) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    pendingWebsiteRef.current = data.website ?? null;

    try {
      await createVendor({
        name: data.name,
        description: data.description || '',
        category: data.category,
        website: data.website || undefined,
        assigneeId: data.assigneeId,
      });

      // Run optional follow-up research (non-blocking)
      const website = pendingWebsiteRef.current;
      pendingWebsiteRef.current = null;
      if (website) {
        fetch('/api/vendors/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ website }),
        }).catch(() => {});
      }

      // Invalidate vendors cache
      mutate(
        (key) =>
          (Array.isArray(key) && key[0]?.includes('/v1/vendors')) ||
          (typeof key === 'string' && key.includes('/v1/vendors')),
        undefined,
        { revalidate: true },
      );

      toast.success(t('create.vendorCreated'));
      onSuccess?.();
    } catch (error) {
      pendingWebsiteRef.current = null;
      toast.error(error instanceof Error ? error.message : t('create.vendorCreateFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          void form.handleSubmit(onSubmit)(e);
        }}
      >
        {/* p-1 prevents focus ring (box-shadow) being clipped by overflow containers */}
        <div className="scrollbar-hide h-[calc(100vh-250px)] overflow-auto p-1">
          <div className="space-y-4">
            <VendorNameAutocompleteField form={form} />
            <FormField
              control={form.control}
              name="website"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('create.website')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="mt-3"
                      placeholder={t('create.websitePlaceholder')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tCommon('common.description')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      className="mt-3 min-h-[80px]"
                      placeholder={t('create.vendorDescriptionPlaceholder2')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('create.category')}</FormLabel>
                  <FormControl>
                    <div className="mt-3">
                      <Select {...field} value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('create.selectCategory')} />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(VendorCategory).map((category) => {
                            const formattedCategory = category
                              .toLowerCase()
                              .split('_')
                              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                              .join(' ');
                            return (
                              <SelectItem key={category} value={category}>
                                {formattedCategory}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('create.status')}</FormLabel>
                  <FormControl>
                    <div className="mt-3">
                      <Select {...field} value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('create.selectStatus')} />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(VendorStatus).map((status) => {
                            const formattedStatus = status
                              .toLowerCase()
                              .split('_')
                              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                              .join(' ');
                            return (
                              <SelectItem key={status} value={status}>
                                {formattedStatus}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="assigneeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('create.assignee')}</FormLabel>
                  <FormControl>
                    <div className="mt-3">
                      <SelectAssignee
                        assignees={assignees}
                        assigneeId={field.value ?? null}
                        withTitle={false}
                        onAssigneeChange={field.onChange}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="mt-4 flex justify-end">
            <Button type="submit" variant="default" disabled={isSubmitting}>
              <div className="flex items-center justify-center">
                {t('create.createVendor')}
                <ArrowRightIcon className="ml-2 h-4 w-4" />
              </div>
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
