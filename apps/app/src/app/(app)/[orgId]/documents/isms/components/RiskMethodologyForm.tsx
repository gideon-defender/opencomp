'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Label, Text, Textarea } from '@trycompai/design-system';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { IsmsRiskMethodologyNarrative } from '../isms-types';
import { MethodologyLabelledList } from './MethodologyLabelledList';
import {
  METHODOLOGY_IMPACT_LABELS,
  METHODOLOGY_LEVEL_LABELS,
  METHODOLOGY_LIKELIHOOD_LABELS,
  METHODOLOGY_TREATMENT_LABELS,
} from './risk-methodology-constants';
import { RiskLevelMatrixPreview } from './RiskLevelMatrixPreview';

type Translator = ReturnType<typeof useTranslations<'isms.riskMethodology'>>;

// .trim() runs before .min(), so whitespace-only input fails "required" and
// saved values are stored trimmed.
const createMethodologySchema = (t: Translator) =>
  z.object({
    purpose: z.string().trim().min(1, t('purposeRequired')),
    scope: z.string().trim().min(1, t('scopeRequired')),
    approach: z.string().trim().min(1, t('approachRequired')),
    likelihoodDescriptions: z.array(z.string().trim().min(1, t('required'))).length(5),
    impactDescriptions: z.array(z.string().trim().min(1, t('required'))).length(5),
    acceptanceThresholds: z.array(z.string().trim().min(1, t('required'))).length(5),
    treatmentOptions: z.array(z.string().trim().min(1, t('required'))).length(4),
    responsibilities: z.string().trim().min(1, t('responsibilitiesRequired')),
    frequency: z.string().trim().min(1, t('frequencyRequired')),
    documentation: z.string().trim().min(1, t('documentationRequired')),
  });

export type RiskMethodologyValues = z.infer<ReturnType<typeof createMethodologySchema>>;

interface RiskMethodologyFormProps {
  narrative: IsmsRiskMethodologyNarrative;
  canEdit: boolean;
  onSave: (values: RiskMethodologyValues) => Promise<void>;
}

const padded = (values: string[], length: number): string[] =>
  Array.from({ length }, (_, index) => values[index] ?? '');

function toDefaults(narrative: IsmsRiskMethodologyNarrative): RiskMethodologyValues {
  return {
    purpose: narrative.purpose ?? '',
    scope: narrative.scope ?? '',
    approach: narrative.approach ?? '',
    likelihoodDescriptions: padded(narrative.likelihoodDescriptions, 5),
    impactDescriptions: padded(narrative.impactDescriptions, 5),
    acceptanceThresholds: padded(narrative.acceptanceThresholds, 5),
    treatmentOptions: padded(narrative.treatmentOptions, 4),
    responsibilities: narrative.responsibilities ?? '',
    frequency: narrative.frequency ?? '',
    documentation: narrative.documentation ?? '',
  };
}

const PROSE_FIELDS = [
  { name: 'purpose', rows: 3 },
  { name: 'scope', rows: 3 },
  { name: 'approach', rows: 4 },
] as const;

const CLOSING_FIELDS = [
  { name: 'responsibilities', rows: 4 },
  { name: 'frequency', rows: 3 },
  { name: 'documentation', rows: 3 },
] as const;

export function RiskMethodologyForm({ narrative, canEdit, onSave }: RiskMethodologyFormProps) {
  const t = useTranslations('isms.riskMethodology');
  const methodologySchema = useMemo(() => createMethodologySchema(t), [t]);
  const {
    control,
    handleSubmit,
    watch,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<RiskMethodologyValues>({
    resolver: zodResolver(methodologySchema),
    defaultValues: toDefaults(narrative),
  });

  const fieldCopy: Record<
    (typeof PROSE_FIELDS)[number]['name'] | (typeof CLOSING_FIELDS)[number]['name'],
    { label: string; helper: string }
  > = useMemo(
    () => ({
      purpose: { label: t('purposeLabel'), helper: t('purposeHelper') },
      scope: { label: t('scopeLabel'), helper: t('scopeHelper') },
      approach: { label: t('approachLabel'), helper: t('approachHelper') },
      responsibilities: { label: t('responsibilitiesLabel'), helper: t('responsibilitiesHelper') },
      frequency: { label: t('frequencyLabel'), helper: t('frequencyHelper') },
      documentation: { label: t('documentationLabel'), helper: t('documentationHelper') },
    }),
    [t],
  );

  const handleSave = handleSubmit(async (values) => {
    await onSave(values);
  });

  const proseField = ({
    name,
    rows,
  }: {
    name: 'purpose' | 'scope' | 'approach' | 'responsibilities' | 'frequency' | 'documentation';
    rows: number;
  }) => {
    const { label, helper } = fieldCopy[name];
    return (
      <div key={name} className="flex flex-col gap-2">
        <Label htmlFor={`methodology-${name}`}>{label}</Label>
        <div className="text-muted-foreground">
          <Text variant="muted">{helper}</Text>
        </div>
        {canEdit ? (
          <div className="flex flex-col gap-1">
            <Controller
              control={control}
              name={name}
              render={({ field: { ...field } }) => (
                <Textarea {...field} id={`methodology-${name}`} rows={rows} aria-label={label} />
              )}
            />
            {errors[name] && (
              <span role="alert" className="text-xs text-destructive">
                {errors[name]?.message}
              </span>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{narrative[name] || '—'}</p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-8">
      {PROSE_FIELDS.map(proseField)}

      <MethodologyLabelledList<RiskMethodologyValues>
        title={t('likelihoodTitle')}
        helper={t('likelihoodHelper')}
        labels={METHODOLOGY_LIKELIHOOD_LABELS}
        name="likelihoodDescriptions"
        control={control}
        canEdit={canEdit}
        // eslint-disable-next-line react-hooks/incompatible-library -- React Compiler intentional skip: RHF watch() cannot be memoized safely
        values={watch('likelihoodDescriptions')}
        rowErrors={errors.likelihoodDescriptions?.map?.((e) => e?.message)}
      />

      <MethodologyLabelledList<RiskMethodologyValues>
        title={t('impactTitle')}
        helper={t('impactHelper')}
        labels={METHODOLOGY_IMPACT_LABELS}
        name="impactDescriptions"
        control={control}
        canEdit={canEdit}
        values={watch('impactDescriptions')}
        rowErrors={errors.impactDescriptions?.map?.((e) => e?.message)}
      />

      <div className="flex flex-col gap-2">
        <Text weight="semibold">{t('matrixTitle')}</Text>
        <RiskLevelMatrixPreview />
      </div>

      <MethodologyLabelledList<RiskMethodologyValues>
        title={t('thresholdsTitle')}
        helper={t('thresholdsHelper')}
        labels={METHODOLOGY_LEVEL_LABELS}
        name="acceptanceThresholds"
        control={control}
        canEdit={canEdit}
        values={watch('acceptanceThresholds')}
        rowErrors={errors.acceptanceThresholds?.map?.((e) => e?.message)}
      />

      <MethodologyLabelledList<RiskMethodologyValues>
        title={t('treatmentTitle')}
        helper={t('treatmentHelper')}
        labels={METHODOLOGY_TREATMENT_LABELS}
        name="treatmentOptions"
        control={control}
        canEdit={canEdit}
        values={watch('treatmentOptions')}
        rowErrors={errors.treatmentOptions?.map?.((e) => e?.message)}
      />

      {CLOSING_FIELDS.map(proseField)}

      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" loading={isSubmitting} disabled={isSubmitting || !isDirty}>
            {isSubmitting ? t('saving') : t('save')}
          </Button>
        </div>
      )}
    </form>
  );
}
