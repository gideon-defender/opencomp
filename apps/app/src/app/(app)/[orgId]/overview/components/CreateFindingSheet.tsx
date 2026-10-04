'use client';

import { useApiSWR } from '@/hooks/use-api-swr';
import {
  DEFAULT_FINDING_TEMPLATES,
  extractOrgFrameworkTypes,
  FINDING_TYPE_FRAMEWORK_OPTIONS,
  FINDING_TYPE_LABELS,
  useFindingActions,
  useFindingTemplates,
  type CreateFindingData,
  type FindingTemplate,
} from '@/hooks/use-findings-api';
import { usePermissions } from '@/hooks/use-permissions';
import { FindingArea, FindingSeverity, FindingType } from '@db';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@gideon-defender/ui/form';
import { useMediaQuery } from '@gideon-defender/ui/hooks';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@trycompai/design-system';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

type TargetKind =
  'task' | 'policy' | 'vendor' | 'risk' | 'member' | 'device' | 'evidenceFormType' | 'area';

type TargetKindKey =
  | 'findings.targetKindTask'
  | 'findings.targetKindPolicy'
  | 'findings.targetKindVendor'
  | 'findings.targetKindRisk'
  | 'findings.targetKindMember'
  | 'findings.targetKindDevice'
  | 'findings.targetKindDocumentType';

const TARGET_KIND_KEYS: Record<Exclude<TargetKind, 'area'>, TargetKindKey> = {
  task: 'findings.targetKindTask',
  policy: 'findings.targetKindPolicy',
  vendor: 'findings.targetKindVendor',
  risk: 'findings.targetKindRisk',
  member: 'findings.targetKindMember',
  device: 'findings.targetKindDevice',
  evidenceFormType: 'findings.targetKindDocumentType',
};

type SeverityLabelKey =
  | 'findings.severityLow'
  | 'findings.severityMedium'
  | 'findings.severityHigh'
  | 'findings.severityCritical';

const SEVERITY_LABEL_KEYS: Record<FindingSeverity, SeverityLabelKey> = {
  low: 'findings.severityLow',
  medium: 'findings.severityMedium',
  high: 'findings.severityHigh',
  critical: 'findings.severityCritical',
};

type CategoryLabelKey =
  | 'findings.categoryEvidenceIssue'
  | 'findings.categoryFurtherEvidence'
  | 'findings.categoryTaskSpecific'
  | 'findings.categoryNaIncorrect';

const CATEGORY_LABEL_KEYS: Record<string, CategoryLabelKey> = {
  evidence_issue: 'findings.categoryEvidenceIssue',
  further_evidence: 'findings.categoryFurtherEvidence',
  task_specific: 'findings.categoryTaskSpecific',
  na_incorrect: 'findings.categoryNaIncorrect',
};

interface CreateFindingSheetProps {
  organizationId: string;
  /** Pre-select a target (e.g. when opening from a specific page). */
  defaultTarget?: { kind: TargetKind; id?: string };
  /** Optional submit override (admin uses this to post to the admin org-scoped endpoint). */
  createFn?: (payload: CreateFindingData) => Promise<void>;
  /**
   * Optional override of the picker data endpoints. Used by the platform-admin
   * surface so the pickers fetch from `/v1/admin/organizations/<orgId>/...`
   * instead of the current session's org. A `null` override disables the
   * picker for that kind (e.g. when no admin endpoint exists).
   */
  endpointOverrides?: Partial<Record<TargetKind, string | null>>;
  /**
   * Target kinds to hide from the dropdown entirely. Used by the admin surface
   * to disable target types that have no admin-scoped data endpoint.
   */
  disabledTargetKinds?: TargetKind[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateFindingSheet({
  defaultTarget,
  createFn,
  endpointOverrides,
  disabledTargetKinds,
  open,
  onOpenChange,
  onSuccess,
}: CreateFindingSheetProps) {
  const t = useTranslations('overview');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { hasPermission } = usePermissions();
  const canCreateFinding = hasPermission('finding', 'create');

  const createFindingSchema = useMemo(
    () =>
      z.object({
        targetKind: z.custom<TargetKind>(),
        targetId: z.string().optional(),
        type: z.nativeEnum(FindingType),
        severity: z.nativeEnum(FindingSeverity),
        templateId: z.string().nullable().optional(),
        content: z.string().min(1, t('findings.contentRequired')),
      }),
    [t],
  );
  type FormValues = z.infer<typeof createFindingSchema>;

  const { data: templatesData } = useFindingTemplates();
  const { createFinding } = useFindingActions();

  // Detect which frameworks the org has enabled. Used to (a) gate the Framework
  // dropdown so an auditor can only attribute a finding to a framework the org
  // actually subscribes to, and (b) auto-select sensible defaults below.
  const { data: frameworksData } = useApiSWR<unknown>('/v1/frameworks?includeScores=false', {
    refreshInterval: 0,
  });
  const frameworksLoaded = frameworksData !== undefined;
  const orgFrameworkTypes = useMemo<FindingType[]>(
    () => extractOrgFrameworkTypes(frameworksData),
    [frameworksData],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(createFindingSchema),
    defaultValues: {
      targetKind: defaultTarget?.kind ?? 'task',
      targetId: defaultTarget?.id ?? '',
      type: FindingType.soc2,
      severity: FindingSeverity.medium,
      templateId: null,
      content: '',
    },
  });

  // Once the org's frameworks are known, ensure the Framework dropdown is on a
  // value the org actually subscribes to — the form defaults to SOC 2, which
  // would be invalid for an ISO-only / HIPAA-only / PCI-only org.
  useEffect(() => {
    if (orgFrameworkTypes.length === 0) return;
    const current = form.getValues('type');
    if (!orgFrameworkTypes.includes(current)) {
      form.setValue('type', orgFrameworkTypes[0]!);
    }
  }, [orgFrameworkTypes, form]);

  // eslint-disable-next-line react-hooks/incompatible-library -- React Compiler intentional skip: RHF watch() cannot be memoized safely
  const targetKind = form.watch('targetKind');
  const selectedTemplateId = form.watch('templateId');

  const targetOptions = useMemo<{ value: TargetKind; label: string }[]>(
    () => [
      { value: 'task', label: t('findings.targetKindTask') },
      { value: 'policy', label: t('findings.targetKindPolicy') },
      { value: 'vendor', label: t('findings.targetKindVendor') },
      { value: 'risk', label: t('findings.targetKindRisk') },
      { value: 'member', label: t('findings.targetKindMember') },
      { value: 'device', label: t('findings.targetKindDevice') },
      { value: 'evidenceFormType', label: t('findings.targetKindDocumentType') },
      { value: 'area', label: t('findings.targetKindArea') },
    ],
    [t],
  );

  const availableTargetOptions = useMemo(
    () =>
      disabledTargetKinds && disabledTargetKinds.length > 0
        ? targetOptions.filter((o) => !disabledTargetKinds.includes(o.value))
        : targetOptions,
    [disabledTargetKinds, targetOptions],
  );

  const apiTemplates: FindingTemplate[] = templatesData?.data || [];
  const templates: FindingTemplate[] =
    apiTemplates.length > 0 ? apiTemplates : DEFAULT_FINDING_TEMPLATES;

  const selectedTemplate = useMemo(() => {
    if (!selectedTemplateId) return null;
    return templates.find((t) => t.id === selectedTemplateId) ?? null;
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    if (selectedTemplate) form.setValue('content', selectedTemplate.content);
  }, [selectedTemplate, form]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      setIsSubmitting(true);
      try {
        const payload: CreateFindingData = {
          type: values.type,
          severity: values.severity,
          content: values.content,
          templateId: values.templateId?.startsWith('default_')
            ? undefined
            : (values.templateId ?? undefined),
        };

        const targetId = values.targetId?.trim();
        if (values.targetKind === 'area') {
          payload.area = (targetId as FindingArea) || FindingArea.people;
        } else if (values.targetKind === 'evidenceFormType') {
          payload.evidenceFormType = targetId as CreateFindingData['evidenceFormType'];
        } else if (values.targetKind === 'task' && targetId) payload.taskId = targetId;
        else if (values.targetKind === 'policy' && targetId) payload.policyId = targetId;
        else if (values.targetKind === 'vendor' && targetId) payload.vendorId = targetId;
        else if (values.targetKind === 'risk' && targetId) payload.riskId = targetId;
        else if (values.targetKind === 'member' && targetId) payload.memberId = targetId;
        else if (values.targetKind === 'device' && targetId) payload.deviceId = targetId;

        const hasTarget =
          payload.taskId ||
          payload.policyId ||
          payload.vendorId ||
          payload.riskId ||
          payload.memberId ||
          payload.deviceId ||
          payload.evidenceFormType ||
          payload.area;

        if (!hasTarget) {
          toast.error(t('findings.selectTargetError'));
          return;
        }

        if (createFn) {
          await createFn(payload);
        } else {
          await createFinding(payload);
        }
        toast.success(t('findings.createdSuccess'));
        onOpenChange(false);
        form.reset();
        onSuccess?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('findings.createError'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [createFinding, createFn, form, onOpenChange, onSuccess, t],
  );

  const groupedTemplates = useMemo<Record<string, FindingTemplate[]>>(() => {
    return templates.reduce<Record<string, FindingTemplate[]>>((acc, template) => {
      if (!acc[template.category]) acc[template.category] = [];
      acc[template.category].push(template);
      return acc;
    }, {});
  }, [templates]);

  const findingForm = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 w-full max-w-none">
        <FormField
          control={form.control}
          name="targetKind"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('findings.linkFindingTo')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value as TargetKind);
                  form.setValue('targetId', '');
                }}
              >
                <SelectTrigger>
                  {availableTargetOptions.find((o) => o.value === field.value)?.label}
                </SelectTrigger>
                <SelectContent>
                  {availableTargetOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <TargetPicker
          kind={targetKind}
          value={form.watch('targetId') ?? ''}
          onChange={(v) => form.setValue('targetId', v)}
          endpointOverrides={endpointOverrides}
        />

        <FormField
          control={form.control}
          name="severity"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('findings.severity')}</FormLabel>
              <Select
                value={field.value}
                onValueChange={(v) => field.onChange(v as FindingSeverity)}
              >
                <SelectTrigger>{t(SEVERITY_LABEL_KEYS[field.value])}</SelectTrigger>
                <SelectContent>
                  {(['low', 'medium', 'high', 'critical'] as FindingSeverity[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(SEVERITY_LABEL_KEYS[s])}
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
          name="type"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('findings.framework')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>{FINDING_TYPE_LABELS[field.value as FindingType]}</SelectTrigger>
                <SelectContent>
                  {FINDING_TYPE_FRAMEWORK_OPTIONS.map(({ value, label }) => (
                    <SelectItem
                      key={value}
                      value={value}
                      // Gate by the org's enabled frameworks once they're
                      // loaded. While loading (frameworksLoaded === false)
                      // leave everything enabled so the dropdown doesn't
                      // flicker into a fully-disabled state on first paint.
                      disabled={
                        frameworksLoaded && !orgFrameworkTypes.includes(value as FindingType)
                      }
                    >
                      {label}
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
          name="templateId"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('findings.templateLabel')}</FormLabel>
              <Select
                value={field.value || 'none'}
                onValueChange={(value) => {
                  if (!value || value === 'none') {
                    field.onChange(null);
                    form.setValue('content', '');
                  } else {
                    field.onChange(value);
                  }
                }}
              >
                <SelectTrigger>
                  <span className="block max-w-full truncate text-left">
                    {selectedTemplate ? selectedTemplate.title : t('findings.selectTemplate')}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('findings.noTemplate')}</SelectItem>
                  {Object.entries(groupedTemplates).map(([category, tpls]) => (
                    <SelectGroup key={category}>
                      <SelectLabel>
                        {CATEGORY_LABEL_KEYS[category]
                          ? t(CATEGORY_LABEL_KEYS[category])
                          : category}
                      </SelectLabel>
                      {tpls.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('findings.details')}</FormLabel>
              <FormControl>
                <Textarea {...field} placeholder={t('findings.detailsPlaceholder')} rows={6} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end pt-4">
          <Button type="submit" disabled={isSubmitting || !canCreateFinding} loading={isSubmitting}>
            {t('findings.createTitle')}
          </Button>
        </div>
      </form>
    </Form>
  );

  if (isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('findings.createTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>{findingForm}</SheetBody>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('findings.createTitle')}</DrawerTitle>
        </DrawerHeader>
        <div className="p-4">{findingForm}</div>
      </DrawerContent>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Target pickers — one per kind. Lightweight free-text + type-ahead via SWR.
// ---------------------------------------------------------------------------

type Option = { id: string; label: string };

function TargetPicker({
  kind,
  value,
  onChange,
  endpointOverrides,
}: {
  kind: TargetKind;
  value: string;
  onChange: (value: string) => void;
  endpointOverrides?: Partial<Record<TargetKind, string | null>>;
}) {
  const t = useTranslations('overview');
  if (kind === 'area') {
    const areaOptions: { value: FindingArea; label: string }[] = [
      { value: FindingArea.people, label: t('findings.areaPeople') },
      { value: FindingArea.documents, label: t('findings.areaDocuments') },
      { value: FindingArea.compliance, label: t('findings.areaCompliance') },
      { value: FindingArea.risks, label: t('findings.areaRisks') },
      { value: FindingArea.vendors, label: t('findings.areaVendors') },
      { value: FindingArea.policies, label: t('findings.areaPolicies') },
    ];
    return (
      <div className="w-full">
        <label className="text-sm font-medium">{t('findings.targetKindArea')}</label>
        <Select value={value || FindingArea.people} onValueChange={(v) => onChange(v ?? '')}>
          <SelectTrigger>
            {areaOptions.find((a) => a.value === (value || FindingArea.people))?.label}
          </SelectTrigger>
          <SelectContent>
            {areaOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <EntityPicker
      kind={kind}
      value={value}
      onChange={onChange}
      endpointOverrides={endpointOverrides}
    />
  );
}

function EntityPicker({
  kind,
  value,
  onChange,
  endpointOverrides,
}: {
  kind: Exclude<TargetKind, 'area'>;
  value: string;
  onChange: (value: string) => void;
  endpointOverrides?: Partial<Record<TargetKind, string | null>>;
}) {
  const t = useTranslations('overview');
  const endpoint = useMemo(() => {
    // An explicit override (including `null`) wins over the default. `null`
    // means "no admin endpoint exists for this kind", so skip fetching.
    if (endpointOverrides && kind in endpointOverrides) {
      return endpointOverrides[kind] ?? null;
    }
    return endpointForKind(kind);
  }, [kind, endpointOverrides]);
  const { data } = useApiSWR<unknown>(endpoint, { refreshInterval: 0 });
  const options = useMemo<Option[]>(() => extractOptions(kind, data), [kind, data]);

  return (
    <div className="w-full">
      <label className="text-sm font-medium">
        {t('findings.selectTarget', { kind: t(TARGET_KIND_KEYS[kind]) })}
      </label>
      <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
        <SelectTrigger>
          <span className="block max-w-full truncate text-left">
            {options.find((o) => o.id === value)?.label ?? t('findings.selectPlaceholder')}
          </span>
        </SelectTrigger>
        <SelectContent>
          {options.length === 0 && (
            <SelectItem value="__none" disabled>
              {t('findings.noOptions')}
            </SelectItem>
          )}
          {options.map((opt) => (
            <SelectItem key={opt.id} value={opt.id}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function endpointForKind(kind: Exclude<TargetKind, 'area'>): string | null {
  switch (kind) {
    case 'task':
      return '/v1/tasks';
    case 'policy':
      return '/v1/policies';
    case 'vendor':
      return '/v1/vendors';
    case 'risk':
      return '/v1/risks';
    case 'member':
      return '/v1/people';
    case 'device':
      return '/v1/devices';
    case 'evidenceFormType':
      return '/v1/evidence-forms';
    default:
      return null;
  }
}

function extractOptions(kind: Exclude<TargetKind, 'area'>, data: unknown): Option[] {
  if (!data) return [];
  // `useApiSWR` wraps responses as { data: T }. Different endpoints return
  // T as either an array, a { data: [...] } envelope, or a { data: { data: [...] } }
  // double-envelope. Normalise all three here.
  const payload = (data as { data?: unknown }).data;
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray(
            ((payload as { data?: { data?: unknown } })?.data as { data?: unknown })?.data,
          )
        ? (payload as { data: { data: unknown[] } }).data.data
        : [];

  return list
    .map((raw): Option | null => {
      const item = raw as Record<string, unknown>;

      // Document types use `type` as the ID (matches Finding.evidenceFormType).
      if (kind === 'evidenceFormType') {
        const type = typeof item.type === 'string' ? item.type : null;
        if (!type) return null;
        const title = (typeof item.title === 'string' && item.title) || type;
        return { id: type, label: title };
      }

      const id = typeof item.id === 'string' ? item.id : null;
      if (!id) return null;

      if (kind === 'member') {
        const user = item.user as { name?: string; email?: string } | undefined;
        return { id, label: user?.name || user?.email || id };
      }

      const label =
        (typeof item.name === 'string' && item.name) ||
        (typeof item.title === 'string' && item.title) ||
        (typeof item.hostname === 'string' && item.hostname) ||
        id;
      return { id, label: String(label) };
    })
    .filter((x): x is Option => x !== null);
}
