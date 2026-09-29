'use client';

import {
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  PageHeader,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  Textarea,
} from '@trycompai/design-system';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useState } from 'react';

type FieldDef = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string;
  description?: string;
  options?: ReadonlyArray<{ label: string; value: string }>;
  accept?: string;
};

interface PortalFormClientProps {
  formTitle: string;
  formDescription: string;
  fields: ReadonlyArray<FieldDef>;
  submitAction: (formData: FormData) => Promise<void>;
  successMessage?: boolean;
  errorMessage?: string;
}

export function PortalFormClient({
  formTitle,
  formDescription,
  fields,
  submitAction,
  successMessage,
  errorMessage,
}: PortalFormClientProps) {
  const params = useParams<{ orgId: string }>();
  const [selectedFiles, setSelectedFiles] = useState<Record<string, string>>({});
  const t = useTranslations('forms');

  const isCompact = (f: FieldDef) => f.type === 'text' || f.type === 'date' || f.type === 'select';

  // Sort compact fields: dates first, then the rest (matches app behavior)
  const compactFields = (() => {
    const compact = fields.filter(isCompact);
    const dateFields = compact.filter((f) => f.type === 'date');
    const nonDateFields = compact.filter((f) => f.type !== 'date');
    return [...dateFields, ...nonDateFields];
  })();

  const fullWidthFields = fields.filter((f) => !isCompact(f));

  return (
    <Stack gap="lg">
      <PageHeader title={t('newSubmission', { title: formTitle })} />
      <Text variant="muted">{formDescription}</Text>

      {successMessage && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          {t('savedSuccess')}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {errorMessage}
        </div>
      )}

      <Section>
        <form action={submitAction} className="space-y-6">
          {/* Compact fields (text, date, select) in 2-column grid */}
          {compactFields.length > 0 && (
            <FieldGroup>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {compactFields.map((field) => (
                  <Field key={field.key}>
                    <FieldLabel htmlFor={field.key}>{field.label}</FieldLabel>
                    {field.description && (
                      <Text size="sm" variant="muted">
                        {field.description}
                      </Text>
                    )}

                    {field.type === 'text' && (
                      <Input
                        id={field.key}
                        name={field.key}
                        required={field.required}
                        placeholder={field.placeholder}
                      />
                    )}

                    {field.type === 'date' && (
                      <Input
                        id={field.key}
                        name={field.key}
                        type="date"
                        required={field.required}
                      />
                    )}

                    {field.type === 'select' && (
                      <Select name={field.key} required={field.required}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('selectPlaceholder', { label: field.label.toLowerCase() })} />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options ?? []).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                ))}
              </div>
            </FieldGroup>
          )}

          {/* Full-width fields (textarea, file) */}
          {fullWidthFields.length > 0 && (
            <FieldGroup>
              {fullWidthFields.map((field) => (
                <Field key={field.key}>
                  <FieldLabel htmlFor={field.key}>{field.label}</FieldLabel>
                  {field.description && (
                    <Text size="sm" variant="muted">
                      {field.description}
                    </Text>
                  )}

                  {field.type === 'textarea' && (
                    <div className="space-y-3">
                      <Textarea
                        id={field.key}
                        name={field.key}
                        style={{
                          width: '100%',
                          maxWidth: 'none',
                          maxHeight: '350px',
                          minHeight: '350px',
                        }}
                        required={field.required}
                        placeholder={field.placeholder}
                        rows={12}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('charLimit')}
                      </p>
                    </div>
                  )}

                  {field.type === 'file' && (
                    <div className="space-y-2">
                      <label htmlFor={field.key} className="block cursor-pointer">
                        <div className="rounded-md border-2 border-dashed border-border bg-muted/20 p-6 text-center transition hover:bg-muted/40">
                          <p className="text-sm font-medium text-foreground">
                            {t('dropFile')}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('maxFileSize')}
                          </p>
                        </div>
                      </label>
                      <input
                        id={field.key}
                        name={field.key}
                        type="file"
                        required={field.required}
                        accept={field.accept}
                        className="sr-only"
                        onChange={(event) => {
                          const selectedFile = event.target.files?.[0];
                          setSelectedFiles((current) => ({
                            ...current,
                            [field.key]: selectedFile?.name ?? '',
                          }));
                        }}
                      />
                      {selectedFiles[field.key] && (
                        <Text size="sm" variant="muted">
                          {t('selectedFile', { name: selectedFiles[field.key] })}
                        </Text>
                      )}
                      <Text size="sm" variant="muted">
                        {t('acceptedTypes', { types: field.accept ?? t('allFileTypes') })}
                      </Text>
                    </div>
                  )}
                </Field>
              ))}
            </FieldGroup>
          )}

          <div className="flex items-center justify-between">
            <Link href={`/${params.orgId}`}>
              <Button type="button" variant="ghost">
                {t('cancel')}
              </Button>
            </Link>
            <Button type="submit">{t('submitForm')}</Button>
          </div>
        </form>
      </Section>
    </Stack>
  );
}
