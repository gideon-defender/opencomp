'use client';

import type { Finding } from '@/hooks/use-findings-api';
import { formatDate } from '@/lib/format';
import { FindingSeverity, FindingStatus } from '@db';
import { Badge } from '@gideon-defender/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gideon-defender/ui/table';
import { useTranslations } from 'next-intl';

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

export function FindingsTable({
  findings,
  targetLabel,
  onSelect,
}: {
  findings: Finding[];
  targetLabel: (finding: Finding) => string;
  onSelect: (finding: Finding) => void;
}) {
  const t = useTranslations('overview');
  return (
    <Table className="border">
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
        {findings.map((f) => (
          <TableRow key={f.id} onClick={() => onSelect(f)} className="cursor-pointer">
            <TableCell className="w-90 max-w-90">
              <span className="block truncate text-sm text-muted-foreground" title={targetLabel(f)}>
                {targetLabel(f)}
              </span>
            </TableCell>
            <TableCell className="w-90 max-w-90">
              <span className="block truncate text-sm font-medium" title={f.content}>
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
              <span className="text-sm text-muted-foreground">{formatDate(f.updatedAt)}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
