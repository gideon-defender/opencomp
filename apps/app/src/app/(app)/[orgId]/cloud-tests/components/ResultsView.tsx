'use client';

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trycompai/design-system';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Settings, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { FindingsTable } from './FindingsTable';

interface Finding {
  id: string;
  title: string | null;
  description: string | null;
  remediation: string | null;
  status: string | null;
  severity: string | null;
  completedAt: Date | null;
}

interface ResultsViewProps {
  findings: Finding[];
  onRunScan: () => Promise<string | null>;
  isScanning: boolean;
  needsConfiguration?: boolean;
  onConfigure?: () => void;
  canRunScan?: boolean;
}

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function ResultsView({
  findings,
  onRunScan,
  isScanning,
  needsConfiguration,
  onConfigure,
  canRunScan = true,
}: ResultsViewProps) {
  const t = useTranslations('cloudTests');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [scanCompleted, setScanCompleted] = useState(false);

  const uniqueStatuses = Array.from(
    new Set(findings.map((f) => f.status).filter(Boolean) as string[]),
  );
  const uniqueSeverities = Array.from(
    new Set(findings.map((f) => f.severity).filter(Boolean) as string[]),
  );

  const allPassed = findings.length > 0 && findings.every((f) => f.status === 'passed');

  const filteredFindings = findings.filter((finding) => {
    const matchesStatus = selectedStatus === 'all' || finding.status === selectedStatus;
    const matchesSeverity = selectedSeverity === 'all' || finding.severity === selectedSeverity;
    return matchesStatus && matchesSeverity;
  });

  const sortedFindings = useMemo(
    () =>
      [...filteredFindings].sort((a, b) => {
        const severityA = a.severity
          ? (severityOrder[a.severity.toLowerCase() as keyof typeof severityOrder] ?? 999)
          : 999;
        const severityB = b.severity
          ? (severityOrder[b.severity.toLowerCase() as keyof typeof severityOrder] ?? 999)
          : 999;
        return severityA - severityB;
      }),
    [filteredFindings],
  );

  const handleRunScan = async () => {
    setScanCompleted(false);
    const result = await onRunScan();
    if (result) {
      setScanCompleted(true);
      // Hide the success message after 5 seconds
      setTimeout(() => setScanCompleted(false), 5000);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {needsConfiguration && onConfigure && (
        <div className="bg-warning/10 rounded-lg border border-warning/30 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-warning-foreground">
                {t('results.configurationRequired')}
              </p>
              <p className="text-sm text-warning-foreground/80 mt-1">
                {t('results.configurationDescription')}
              </p>
            </div>
          </div>
          <div className="mt-3 ml-8">
            <Button
              size="sm"
              variant="outline"
              onClick={onConfigure}
              iconLeft={<Settings className="h-4 w-4" />}
            >
              {t('results.configure')}
            </Button>
          </div>
        </div>
      )}

      {isScanning && (
        <div className="bg-primary/10 flex items-center gap-3 rounded-lg border border-primary/20 p-4">
          <Loader2 className="text-primary h-5 w-5 animate-spin flex-shrink-0" />
          <div className="flex-1">
            <p className="text-primary text-sm font-medium">
              {t('results.scanningInProgress')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('results.scanningDescription')}
            </p>
          </div>
        </div>
      )}

      {scanCompleted && !isScanning && (
        <div className="bg-primary/10 flex items-center gap-3 rounded-lg border border-primary/20 p-4">
          <CheckCircle2 className="text-primary h-5 w-5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-primary text-sm font-medium">{t('results.scanCompleted')}</p>
            <p className="text-muted-foreground text-xs">{t('results.resultsUpdated')}</p>
          </div>
        </div>
      )}

      {allPassed && !isScanning && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/50">
          <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              {t('results.allChecksPassed')}
            </p>
            <p className="text-xs text-green-700/80 dark:text-green-400/80">
              {t('results.noIssuesAcrossChecks', { count: findings.length })}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        {findings.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-[160px]">
              <Select
                value={selectedSeverity}
                onValueChange={(v) => {
                  if (v) setSelectedSeverity(v);
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder={t('allSeverities')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allSeverities')}</SelectItem>
                  {uniqueSeverities.map((severity) => (
                    <SelectItem key={severity} value={severity}>
                      {severity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-[160px]">
              <Select
                value={selectedStatus}
                onValueChange={(v) => {
                  if (v) setSelectedStatus(v);
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder={t('allStatuses')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allStatuses')}</SelectItem>
                  {uniqueStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(selectedSeverity !== 'all' || selectedStatus !== 'all') && (
              <p className="text-muted-foreground ml-2 text-sm">
                {t('results.findingsCount', {
                  filtered: sortedFindings.length,
                  total: findings.length,
                })}
              </p>
            )}
          </div>
        ) : (
          <div />
        )}

        {canRunScan && (
          <Button
            onClick={handleRunScan}
            disabled={isScanning}
            loading={isScanning}
            iconLeft={!isScanning ? <RefreshCw className="h-4 w-4" /> : undefined}
          >
            {isScanning ? t('scanning') : t('runScan')}
          </Button>
        )}
      </div>

      {sortedFindings.length > 0 ? (
        <FindingsTable findings={sortedFindings} />
      ) : findings.length > 0 ? (
        <div className="text-muted-foreground rounded-xs border p-12 text-center">
          <p className="text-lg">{t('results.noFilterMatch')}</p>
          <p className="mt-2 text-sm">{t('results.adjustFilters')}</p>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-muted-foreground text-lg">{t('results.noResultsYet')}</p>
          <p className="text-muted-foreground mt-2 text-sm">{t('runScanHint')}</p>
        </div>
      )}
    </div>
  );
}
