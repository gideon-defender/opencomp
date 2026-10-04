'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { useVendorActions } from '@/hooks/use-vendors';
import { Impact, Likelihood } from '@db';
import { Button } from '@gideon-defender/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@gideon-defender/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Select, SelectItem, Stack } from '@trycompai/design-system';
import { useTranslations } from 'next-intl';
import { useQueryState } from 'nuqs';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';
import { z } from 'zod';

const formSchema = z.object({
  residualProbability: z.nativeEnum(Likelihood),
  residualImpact: z.nativeEnum(Impact),
});

type FormValues = z.infer<typeof formSchema>;

interface ResidualRiskFormProps {
  vendorId: string;
  initialProbability?: Likelihood;
  initialImpact?: Impact;
}

export function ResidualRiskForm({
  vendorId,
  initialProbability = Likelihood.very_unlikely,
  initialImpact = Impact.insignificant,
}: ResidualRiskFormProps) {
  const { hasPermission } = usePermissions();
  const { updateVendor } = useVendorActions();
  const { mutate: globalMutate } = useSWRConfig();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, setOpen] = useQueryState('residual-risk-sheet');
  const t = useTranslations('vendor');
  const tCommon = useTranslations('overview');

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      residualProbability: initialProbability,
      residualImpact: initialImpact,
    },
  });

  async function onSubmit(values: FormValues) {
    setIsSubmitting(true);
    try {
      await updateVendor(vendorId, {
        residualProbability: values.residualProbability,
        residualImpact: values.residualImpact,
      });

      toast.success(t('risk.residualRiskUpdated'));
      globalMutate(
        (key) =>
          (Array.isArray(key) && key[0]?.includes('/v1/vendors')) ||
          (typeof key === 'string' && key.includes('/v1/vendors')),
        undefined,
        { revalidate: true },
      );
      setOpen(null);
    } catch {
      toast.error(t('risk.unexpectedError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Stack gap="4">
          <FormField
            control={form.control}
            name="residualProbability"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('risk.residualProbability')}</FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectItem value={Likelihood.very_likely}>
                      {t('risk.likelihoodVeryLikely')}
                    </SelectItem>
                    <SelectItem value={Likelihood.likely}>{t('risk.likelihoodLikely')}</SelectItem>
                    <SelectItem value={Likelihood.possible}>
                      {t('risk.likelihoodPossible')}
                    </SelectItem>
                    <SelectItem value={Likelihood.unlikely}>
                      {t('risk.likelihoodUnlikely')}
                    </SelectItem>
                    <SelectItem value={Likelihood.very_unlikely}>
                      {t('risk.likelihoodVeryUnlikely')}
                    </SelectItem>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="residualImpact"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('risk.residualImpact')}</FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectItem value={Impact.insignificant}>
                      {t('risk.impactInsignificant')}
                    </SelectItem>
                    <SelectItem value={Impact.minor}>{t('risk.impactMinor')}</SelectItem>
                    <SelectItem value={Impact.moderate}>{t('risk.impactModerate')}</SelectItem>
                    <SelectItem value={Impact.major}>{t('risk.impactMajor')}</SelectItem>
                    <SelectItem value={Impact.severe}>{t('risk.impactSevere')}</SelectItem>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={isSubmitting || !hasPermission('vendor', 'update')}>
              {tCommon('common.save')}
            </Button>
          </div>
        </Stack>
      </form>
    </Form>
  );
}
