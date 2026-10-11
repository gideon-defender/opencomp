'use client';

import { useApiSWR } from '@/hooks/use-api-swr';
import {
  extractOrgFrameworkTypes,
  FINDING_TYPE_LABELS,
  useOrganizationFindings,
  type Finding,
} from '@/hooks/use-findings-api';
import { usePermissions } from '@/hooks/use-permissions';
import { FindingSeverity, FindingStatus, FindingType } from '@db';
import { Button } from '@gideon-defender/ui/button';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreateFindingSheet } from './CreateFindingSheet';
import { FindingDetailSheet } from './FindingDetailSheet';
import { FindingsFilters } from './FindingsFilters';
import { FindingsTable } from './FindingsTable';
import { FindingTemplateManager } from './FindingTemplateManager';

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

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
  const canManageTemplates = hasPermission('finding', 'update');
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);

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

  const handleOpenTemplateManager = () => setTemplateManagerOpen(true);
  const hasAnyFinding = findings.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {canManageTemplates && (
        <div className="self-end">
          <Button type="button" variant="outline" onClick={handleOpenTemplateManager}>
            {t('findings.manageTemplates')}
          </Button>
        </div>
      )}
      {hasAnyFinding && (
        <FindingsFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          severityFilter={severityFilter}
          onSeverityChange={setSeverityFilter}
          frameworkFilter={frameworkFilter}
          onFrameworkChange={setFrameworkFilter}
          statusOptions={statusOptions}
          severityOptions={severityOptions}
          frameworkOptions={frameworkOptions}
        />
      )}

      {!hasAnyFinding ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <div className="text-muted-foreground">
              <TriangleAlert size={24} />
            </div>
            <p className="font-medium">{t('findings.emptyTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('findings.emptyDescription')}</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <p className="font-medium">{t('findings.filterEmptyTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('findings.filterEmptyDescription')}</p>
          </div>
        </div>
      ) : (
        <FindingsTable
          findings={filtered}
          targetLabel={targetLabel}
          onSelect={setSelectedFinding}
        />
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

      {canManageTemplates && (
        <FindingTemplateManager open={templateManagerOpen} onOpenChange={setTemplateManagerOpen} />
      )}
    </div>
  );
}
