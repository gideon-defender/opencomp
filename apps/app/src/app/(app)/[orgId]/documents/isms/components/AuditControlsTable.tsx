'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Badge,
  Button,
  Field,
  FieldError,
  Heading,
  HStack,
  Input,
  Stack,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  Textarea,
} from '@trycompai/design-system';
import { Add } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import type { IsmsAudit, IsmsAuditControl } from '../isms-types';
import { AuditControlRow, type RaisedResult } from './AuditControlRow';
import { auditControlSchema, type AuditControlFormValues } from './audit-schema';
import { IsmsAddCard, IsmsFieldLabel } from './shared';

interface AuditControlsTableProps {
  audit: IsmsAudit;
  canEdit: boolean;
  onCreateControl: (values: AuditControlFormValues) => Promise<void>;
  onUpdateControl: (controlId: string, payload: Record<string, unknown>) => Promise<void>;
  onDeleteControl: (controlId: string) => Promise<void>;
  onResultRaised?: (control: IsmsAuditControl, result: RaisedResult) => void;
}

const EMPTY_CONTROL: AuditControlFormValues = {
  controlRef: '',
  whatWasTested: '',
  whereToFind: '',
  notes: '',
};

/**
 * The Controls Tested table — the heart of the audit. Fifteen default rows are
 * seeded per audit; the customer/auditor works through each: follow the "Where
 * to find it" reference, verify the evidence, and record a Result (plus an
 * optional note). Rows can be added, edited, or removed freely.
 */
export function AuditControlsTable({
  audit,
  canEdit,
  onCreateControl,
  onUpdateControl,
  onDeleteControl,
  onResultRaised,
}: AuditControlsTableProps) {
  const t = useTranslations('isms');
  const controls = audit.controls;

  return (
    <Stack gap="3">
      <HStack align="center" gap="2">
        <Heading level="5">{t('auditControls.title')}</Heading>
        <Badge variant="secondary">{String(controls.length)}</Badge>
      </HStack>
      <Text size="sm" variant="muted">
        {t('auditControls.description')}
      </Text>

      {controls.length === 0 ? (
        <Text size="sm" variant="muted">
          {t('auditControls.empty')}
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('auditControls.columns.controlRef')}</TableHead>
                <TableHead>{t('auditControls.columns.whatWasTested')}</TableHead>
                <TableHead>{t('auditControls.columns.whereToFind')}</TableHead>
                <TableHead>{t('auditControls.columns.result')}</TableHead>
                <TableHead>{t('auditControls.columns.notes')}</TableHead>
                {canEdit ? <TableHead aria-label={t('auditControls.actions')} /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {controls.map((control) => (
                <AuditControlRow
                  key={control.id}
                  control={control}
                  canEdit={canEdit}
                  onUpdateControl={onUpdateControl}
                  onDeleteControl={onDeleteControl}
                  onResultRaised={onResultRaised}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canEdit ? (
        <IsmsAddCard
          addLabel={t('auditControls.addRow')}
          formTitle={t('auditControls.newFormTitle')}
        >
          {({ close }) => <AddControlForm onAdd={onCreateControl} onClose={close} />}
        </IsmsAddCard>
      ) : null}
    </Stack>
  );
}

function AddControlForm({
  onAdd,
  onClose,
}: {
  onAdd: (values: AuditControlFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('isms');
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<AuditControlFormValues>({
    resolver: zodResolver(auditControlSchema),
    defaultValues: EMPTY_CONTROL,
  });

  const handleAdd = handleSubmit(async (values) => {
    try {
      await onAdd(values);
    } catch {
      // Keep the user's input and the form open when the save fails.
      return;
    }
    reset(EMPTY_CONTROL);
    onClose();
  });

  return (
    <form onSubmit={handleAdd} className="flex flex-col gap-3">
      <IsmsFieldLabel label={t('auditControls.form.controlRef')}>
        <Field>
          <Controller
            control={control}
            name="controlRef"
            render={({ field: { ...field }, fieldState }) => (
              <>
                <Input
                  {...field}
                  aria-label={t('auditControls.form.controlRef')}
                  placeholder={t('auditControls.form.controlRefPlaceholder')}
                />
                <FieldError>{fieldState.error?.message}</FieldError>
              </>
            )}
          />
        </Field>
      </IsmsFieldLabel>
      <IsmsFieldLabel label={t('auditControls.form.whatWasTested')}>
        <Controller
          control={control}
          name="whatWasTested"
          render={({ field: { ...field } }) => (
            <Input {...field} aria-label={t('auditControls.form.whatWasTested')} />
          )}
        />
      </IsmsFieldLabel>
      <IsmsFieldLabel label={t('auditControls.form.whereToFind')}>
        <Controller
          control={control}
          name="whereToFind"
          render={({ field: { ...field } }) => (
            <Input
              {...field}
              aria-label={t('auditControls.form.whereToFind')}
              placeholder={t('auditControls.form.whereToFindPlaceholder')}
            />
          )}
        />
      </IsmsFieldLabel>
      <IsmsFieldLabel label={t('auditControls.form.notesOptional')}>
        <Controller
          control={control}
          name="notes"
          render={({ field: { ...field } }) => (
            <Textarea
              {...field}
              rows={2}
              aria-label={t('auditControls.form.notes')}
              placeholder={t('auditControls.form.notesPlaceholder')}
            />
          )}
        />
      </IsmsFieldLabel>
      <HStack justify="end">
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={isSubmitting}
          disabled={isSubmitting}
          iconLeft={<Add size={16} />}
        >
          {t('auditControls.addRow')}
        </Button>
      </HStack>
    </form>
  );
}
