'use client';

import { useApiSWR } from '@/hooks/use-api-swr';
import {
  extractOrgFrameworkTypes,
  FINDING_TYPE_LABELS,
  useOrganizationFindings,
  type Finding,
} from '@/hooks/use-findings-api';
import { usePermissions } from '@/hooks/use-permissions';
import { formatDate } from '@/lib/format';
import { FindingSeverity, FindingStatus, FindingType } from '@db';
import {
  Badge,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { Search, WarningAlt } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreateFindingSheet } from './CreateFindingSheet';
import { FindingDetailSheet } from './FindingDetailSheet';

type SeverityLabelKey =
  | 'findings.severityLow'
  | 'findings.severityMedium'
  | 'findings.severityHigh'
  | 'findings.severityCritical';

type StatusLabelKey =
  | 'findings.statusOpen'
  | 'findings.statusReadyForReview'
  | 'findings.statusNeedsRevision'
  | 'findings.statusClosed';

const SEVERITY_LABEL_KEYS: Record<FindingSeverity, SeverityLabelKey> = {
  low: 'findings.severityLow',
  medium: 'findings.severityMedium',
  high: 'findings.severityHigh',
  critical: 'findings.severityCritical',
};

const STATUS_LABEL_KEYS: Record<FindingStatus, StatusLabelKey> = {
  open: 'findings.statusOpen',
  ready_for_review: 'findings.statusReadyForReview',
  needs_revision: 'findings.statusNeedsRevision',
  closed: 'findings.statusClosed',
};

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const SEVERITY_VARIANT: Record<
  FindingSeverity,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  low: 'outline',
  medium: 'secondary',
  high: 'secondary',
  critical: 'destructive',
};

const STATUS_VARIANT: Record<FindingStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'destructive',
  ready_for_review: 'outline',
  needs_revision: 'secondary',
  closed: 'default',
};

interface FindingsTabProps {
  organizationId: string;
  initialFindings?: Finding[];
  /** Controlled open state for the Create Finding sheet (owned by the page header). */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

export function FindingsTab({
  organizationId,
  initialFindings,
  createOpen: createOpenProp,
  onCreateOpenChange,
}: FindingsTabProps) {
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const createOpen = createOpenProp ?? internalCreateOpen;
  const setCreateOpen = onCreateOpenChange ?? setInternalCreateOpen;

  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FindingStatus | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');
  const [frameworkFilter, setFrameworkFilter] = useState<FindingType | 'all'>('all');

  const t = useTranslations('overview');
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('finding', 'create');

  const statusOptions: { value: FindingStatus | 'all'; label: string }[] = [
    { value: 'all', label: t('findings.allStatuses') },
    { value: FindingStatus.open, label: t('findings.statusOpen') },
    { value: FindingStatus.ready_for_review, label: t('findings.statusReadyForReview') },
    { value: FindingStatus.needs_revision, label: t('findings.statusNeedsRevision') },
    { value: FindingStatus.closed, label: t('findings.statusClosed') },
  ];

  const severityOptions: { value: FindingSeverity | 'all'; label: string }[] = [
    { value: 'all', label: t('findings.allSeverities') },
    { value: FindingSeverity.critical, label: t('findings.severityCritical') },
    { value: FindingSeverity.high, label: t('findings.severityHigh') },
    { value: FindingSeverity.medium, label: t('findings.severityMedium') },
    { value: FindingSeverity.low, label: t('findings.severityLow') },
  ];

  const targetLabel = useCallback(
    (f: Finding): string => {
      if (f.task) return t('findings.taskTarget', { name: f.task.title });
      if (f.policy) return t('findings.policyTarget', { name: f.policy.name });
      if (f.vendor) return t('findings.vendorTarget', { name: f.vendor.name });
      if (f.risk) return t('findings.riskTarget', { name: f.risk.title });
      if (f.member)
        return t('findings.personTarget', {
          name: f.member.user.name ?? f.member.user.email,
        });
      if (f.device)
        return t('findings.deviceTarget', {
          name: f.device.name || f.device.hostname,
        });
      if (f.evidenceSubmission)
        return t('findings.documentTarget', {
          name: f.evidenceSubmission.formType.replace(/-/g, ' '),
        });
      if (f.evidenceFormType)
        return t('findings.documentTarget', {
          name: f.evidenceFormType.replace(/-/g, ' '),
        });
      if (f.area === 'risks') return t('findings.areaRisks');
      if (f.area === 'vendors') return t('findings.areaVendors');
      if (f.area === 'policies') return t('findings.areaPolicies');
      if (f.area) return t('findings.areaTarget', { name: capitalize(f.area) });
      return '—';
    },
    [t],
  );

  const router = useRouter();
  const searchParams = useSearchParams();
  const openFindingId = searchParams?.get('open') ?? null;

  const { data, mutate } = useOrganizationFindings(
    {},
    initialFindings ? { fallbackData: { data: initialFindings, status: 200 } } : {},
  );
  const findings: Finding[] = useMemo(() => (Array.isArray(data?.data) ? data.data : []), [data]);

  // Mirror the Create Finding form: the framework filter must offer every
  // framework the org has actually enabled — not a hardcoded SOC 2 / ISO 27001
  // pair — so findings logged against ISO 42001, HIPAA, etc. are filterable.
  const { data: frameworksData } = useApiSWR<unknown>('/v1/frameworks?includeScores=false', {
    refreshInterval: 0,
  });
  const frameworkOptions = useMemo<{ value: FindingType | 'all'; label: string }[]>(
    () => [
      { value: 'all', label: t('findings.allFrameworks') },
      ...extractOrgFrameworkTypes(frameworksData).map((type) => ({
        value: type,
        label: FINDING_TYPE_LABELS[type],
      })),
    ],
    [frameworksData, t],
  );

  // Support deep links (e.g. emails + in-app notifications) that land on
  // `/overview/findings?open=<id>`. The sheet selection syncs during render
  // (adjust-during-render); the effect below only strips the query param so a
  // page refresh doesn't reopen it — no setState inside the effect.
  if (openFindingId && !selectedFinding) {
    const match = findings.find((f) => f.id === openFindingId);
    if (match) setSelectedFinding(match);
  }

  useEffect(() => {
    if (!openFindingId) return;
    const match = findings.find((f) => f.id === openFindingId);
    if (!match) return;
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.delete('open');
    const query = params.toString();
    router.replace(query ? `?${query}` : '?', { scroll: false });
  }, [openFindingId, findings, router, searchParams]);

  const filtered = useMemo(() => {
    let result = [...findings];

    if (statusFilter !== 'all') {
      result = result.filter((f) => f.status === statusFilter);
    }
    if (severityFilter !== 'all') {
      result = result.filter((f) => f.severity === severityFilter);
    }
    if (frameworkFilter !== 'all') {
      result = result.filter((f) => f.type === frameworkFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) => f.content.toLowerCase().includes(q) || targetLabel(f).toLowerCase().includes(q),
      );
    }

    result.sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      return bTime - aTime;
    });

    return result;
  }, [findings, statusFilter, severityFilter, frameworkFilter, searchQuery, targetLabel]);

  const statusLabel =
    statusOptions.find((o) => o.value === statusFilter)?.label ?? t('common.status');
  const severityLabel =
    severityOptions.find((o) => o.value === severityFilter)?.label ?? t('findings.severity');
  const frameworkLabel =
    frameworkOptions.find((o) => o.value === frameworkFilter)?.label ?? t('findings.framework');

  const hasAnyFinding = findings.length > 0;

  return (
    <Stack gap="md">
      {hasAnyFinding && (
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="w-full md:max-w-[300px]">
            <InputGroup>
              <InputGroupAddon>
                <Search size={16} />
              </InputGroupAddon>
              <InputGroupInput
                placeholder={t('findings.searchFindings')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </InputGroup>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 md:w-[180px] md:flex-none">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter((v ?? 'all') as FindingStatus | 'all')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('common.status')}>{statusLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 md:w-[180px] md:flex-none">
              <Select
                value={severityFilter}
                onValueChange={(v) => setSeverityFilter((v ?? 'all') as FindingSeverity | 'all')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('findings.severity')}>{severityLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {severityOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 md:w-[180px] md:flex-none">
              <Select
                value={frameworkFilter}
                onValueChange={(v) => setFrameworkFilter((v ?? 'all') as FindingType | 'all')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('findings.framework')}>{frameworkLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {frameworkOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {!hasAnyFinding ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WarningAlt size={24} />
            </EmptyMedia>
            <EmptyTitle>{t('findings.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('findings.emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('findings.filterEmptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('findings.filterEmptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table variant="bordered">
          <TableHeader>
            <TableRow>
              <TableHead>{t('findings.target')}</TableHead>
              <TableHead>{t('findings.finding')}</TableHead>
              <TableHead>{t('findings.severity')}</TableHead>
              <TableHead>{t('common.status')}</TableHead>
              <TableHead>{t('common.updated')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((f) => (
              <TableRow
                key={f.id}
                onClick={() => setSelectedFinding(f)}
                style={{ cursor: 'pointer' }}
              >
                <TableCell style={{ maxWidth: 360, width: 360 }}>
                  <span
                    className="block truncate text-sm text-muted-foreground"
                    style={{ maxWidth: 360 }}
                    title={targetLabel(f)}
                  >
                    {targetLabel(f)}
                  </span>
                </TableCell>
                <TableCell style={{ maxWidth: 360, width: 360 }}>
                  <span
                    className="block truncate text-sm font-medium"
                    style={{ maxWidth: 360 }}
                    title={f.content}
                  >
                    {f.content}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={SEVERITY_VARIANT[f.severity]}>
                    {t(SEVERITY_LABEL_KEYS[f.severity])}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[f.status]}>{t(STATUS_LABEL_KEYS[f.status])}</Badge>
                </TableCell>
                <TableCell>
                  <Text size="sm" variant="muted">
                    {formatDate(f.updatedAt)}
                  </Text>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canCreate && (
        <CreateFindingSheet
          organizationId={organizationId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={() => {
            void mutate();
          }}
        />
      )}

      <FindingDetailSheet
        finding={selectedFinding}
        organizationId={organizationId}
        open={selectedFinding !== null}
        onOpenChange={(o) => {
          if (!o) setSelectedFinding(null);
        }}
        onSaved={() => {
          void mutate();
        }}
        onDeleted={() => {
          void mutate();
        }}
      />
    </Stack>
  );
}
