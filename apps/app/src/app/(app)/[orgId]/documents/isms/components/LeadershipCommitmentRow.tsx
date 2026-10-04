'use client';

import { Badge, TableCell, TableRow, Text, Textarea } from '@trycompai/design-system';
import { useTranslations } from 'next-intl';
import { Controller, type Control } from 'react-hook-form';
import {
  type IsmsTranslator,
  type LeadershipCommitmentMeta,
  type LeadershipNarrativeValues,
} from './leadership-schema';

interface LeadershipCommitmentRowProps {
  meta: LeadershipCommitmentMeta;
  index: number;
  canEdit: boolean;
  control: Control<LeadershipNarrativeValues>;
  text: string;
}

function commitmentLabel(t: IsmsTranslator, key: string): string {
  switch (key) {
    case 'a':
      return t('leadership.commitments.a.label');
    case 'b':
      return t('leadership.commitments.b.label');
    case 'c':
      return t('leadership.commitments.c.label');
    case 'd':
      return t('leadership.commitments.d.label');
    case 'e':
      return t('leadership.commitments.e.label');
    case 'f':
      return t('leadership.commitments.f.label');
    case 'g':
      return t('leadership.commitments.g.label');
    default:
      return t('leadership.commitments.h.label');
  }
}

function commitmentPlaceholder(t: IsmsTranslator, key: string): string {
  switch (key) {
    case 'a':
      return t('leadership.commitments.a.placeholder');
    case 'b':
      return t('leadership.commitments.b.placeholder');
    case 'c':
      return t('leadership.commitments.c.placeholder');
    case 'd':
      return t('leadership.commitments.d.placeholder');
    case 'e':
      return t('leadership.commitments.e.placeholder');
    case 'f':
      return t('leadership.commitments.f.placeholder');
    case 'g':
      return t('leadership.commitments.g.placeholder');
    default:
      return t('leadership.commitments.h.placeholder');
  }
}

/**
 * One ISO 27001 clause 5.1 commitment, rendered as a labelled row. Editable as a
 * `Textarea` (RHF Controller) for users with `evidence:update`, otherwise plain
 * read-only text.
 */
export function LeadershipCommitmentRow({
  meta,
  index,
  canEdit,
  control,
  text,
}: LeadershipCommitmentRowProps) {
  const t = useTranslations('isms');
  const label = commitmentLabel(t, meta.key);
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge variant="secondary">{meta.clause}</Badge>
          <Text size="sm" weight="medium">
            {label}
          </Text>
        </div>
      </TableCell>
      <TableCell>
        {canEdit ? (
          <Controller
            control={control}
            name={`commitments.${index}.text`}
            render={({ field: { ...field } }) => (
              <Textarea
                {...field}
                rows={3}
                placeholder={commitmentPlaceholder(t, meta.key)}
                aria-label={t('leadership.commitmentAria', { clause: meta.clause })}
              />
            )}
          />
        ) : (
          <span className="text-sm">{text || '—'}</span>
        )}
      </TableCell>
    </TableRow>
  );
}
