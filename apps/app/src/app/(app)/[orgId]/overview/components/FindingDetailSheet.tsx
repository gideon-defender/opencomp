'use client';

import {
  useFindingActions,
  useFindingHistory,
  type Finding,
  type FindingHistoryEntry,
} from '@/hooks/use-findings-api';

import { Comments } from '@/components/comments/Comments';
import { useAuthMe } from '@/hooks/use-auth-me';
import { usePermissions } from '@/hooks/use-permissions';
import { FindingSeverity, FindingStatus } from '@db';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  HStack,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Stack,
  Text,
  Textarea,
} from '@trycompai/design-system';
import { Copy } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

interface FindingDetailSheetProps {
  finding: Finding | null;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}

/**
 * Mirror of the API's status-transition rules in
 * `findings.service.ts#update`. Showing options the backend forbids leads to
 * predictable 403s on save, so filter to what the current user can actually
 * set. The current status is always preserved so the dropdown can render its
 * own value even if the user can no longer set it.
 */
function allowedStatusOptions({
  current,
  canCreateFindings,
  isPlatformAdmin,
}: {
  current: FindingStatus;
  canCreateFindings: boolean;
  isPlatformAdmin: boolean;
}): FindingStatus[] {
  const options: FindingStatus[] = [FindingStatus.open, FindingStatus.ready_for_review];
  if (canCreateFindings || isPlatformAdmin) {
    options.push(FindingStatus.needs_revision, FindingStatus.closed);
  }
  if (!options.includes(current)) options.push(current);
  return options;
}

const SEVERITY_OPTIONS: FindingSeverity[] = [
  FindingSeverity.low,
  FindingSeverity.medium,
  FindingSeverity.high,
  FindingSeverity.critical,
];

function targetHref(f: Finding, orgId: string): string | null {
  if (f.taskId) return `/${orgId}/tasks/${f.taskId}`;
  if (f.policyId) return `/${orgId}/policies/${f.policyId}`;
  if (f.vendorId) return `/${orgId}/vendors/${f.vendorId}`;
  if (f.riskId) return `/${orgId}/risk/${f.riskId}`;
  if (f.memberId) return `/${orgId}/people/${f.memberId}`;
  if (f.deviceId) return `/${orgId}/people?tab=devices&device=${f.deviceId}`;
  if (f.evidenceSubmission) return `/${orgId}/documents/${f.evidenceSubmission.formType}`;
  if (f.evidenceFormType) return `/${orgId}/documents/${f.evidenceFormType}`;
  if (f.area === 'people') return `/${orgId}/people`;
  if (f.area === 'documents') return `/${orgId}/documents`;
  if (f.area === 'risks') return `/${orgId}/risk`;
  if (f.area === 'vendors') return `/${orgId}/vendors`;
  if (f.area === 'policies') return `/${orgId}/policies`;
  return null;
}

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

type StatusLabelKey =
  | 'findings.statusOpen'
  | 'findings.statusReadyForReview'
  | 'findings.statusNeedsRevision'
  | 'findings.statusClosed';

const STATUS_LABEL_KEYS: Record<FindingStatus, StatusLabelKey> = {
  open: 'findings.statusOpen',
  ready_for_review: 'findings.statusReadyForReview',
  needs_revision: 'findings.statusNeedsRevision',
  closed: 'findings.statusClosed',
};

type LegacyScopeKey =
  | 'findings.legacyScopeDirectory'
  | 'findings.legacyScopeTasks'
  | 'findings.legacyScopeDevices'
  | 'findings.legacyScopeOrgChart';

const LEGACY_SCOPE_KEYS: Record<string, LegacyScopeKey> = {
  people: 'findings.legacyScopeDirectory',
  people_tasks: 'findings.legacyScopeTasks',
  people_devices: 'findings.legacyScopeDevices',
  people_chart: 'findings.legacyScopeOrgChart',
};

/**
 * Rows that pre-date the unified-findings migration have their original
 * `FindingScope` value preserved on the creation AuditLog entry. Surface it
 * so owners/admins can see where the finding was originally filed — otherwise
 * legacy people-scope findings all look identical under `area='people'`.
 */
function legacyScopeFromHistory(history: FindingHistoryEntry[] | undefined): string | null {
  if (!history || history.length === 0) return null;
  // History comes back newest-first; the creation entry is the oldest one.
  const createdEntry = [...history].reverse().find((e) => e.data?.action === 'created');
  const scope = createdEntry?.data?.findingScope;
  if (!scope) return null;
  return scope;
}

export function FindingDetailSheet({
  finding,
  organizationId,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: FindingDetailSheetProps) {
  const t = useTranslations('overview');
  const { hasPermission } = usePermissions();
  const { user } = useAuthMe();
  const canUpdate = hasPermission('finding', 'update');
  const canDelete = hasPermission('finding', 'delete');
  const canCreateFindings = hasPermission('finding', 'create');
  const isPlatformAdmin = user?.role === 'admin';
  const canEditContent = canUpdate && canCreateFindings;
  const { updateFinding, deleteFinding } = useFindingActions();
  const { data: historyData } = useFindingHistory(finding?.id ?? null);

  const [content, setContent] = useState('');
  const [status, setStatus] = useState<FindingStatus>(FindingStatus.open);
  const [severity, setSeverity] = useState<FindingSeverity>(FindingSeverity.medium);
  const [revisionNote, setRevisionNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Reset the editable fields whenever a different finding is opened (including
  // the initial mount with a finding). Adjust-during-render instead of an
  // effect to avoid a synchronous setState-in-effect cascade.
  const [prevFinding, setPrevFinding] = useState<Finding | null>(null);
  if (prevFinding !== finding) {
    setPrevFinding(finding);
    if (finding) {
      setContent(finding.content);
      setStatus(finding.status);
      setSeverity(finding.severity);
      setRevisionNote(finding.revisionNote ?? '');
    }
  }

  if (!finding) return null;

  const targetLabel = (f: Finding): string => {
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
        name: f.evidenceSubmission.formType,
      });
    if (f.evidenceFormType) return t('findings.documentTarget', { name: f.evidenceFormType });
    if (f.area === 'risks') return t('findings.areaRisks');
    if (f.area === 'vendors') return t('findings.areaVendors');
    if (f.area === 'policies') return t('findings.areaPolicies');
    if (f.area) return t('findings.areaTarget', { name: f.area });
    return t('findings.finding');
  };

  const href = targetHref(finding, organizationId);
  const history: FindingHistoryEntry[] = Array.isArray(historyData?.data) ? historyData.data : [];
  const legacyScope = legacyScopeFromHistory(history);
  const legacyScopeLabel = legacyScope
    ? LEGACY_SCOPE_KEYS[legacyScope]
      ? t(LEGACY_SCOPE_KEYS[legacyScope])
      : legacyScope
    : null;

  const contentChanged = canEditContent && content !== finding.content;
  const isDirty =
    contentChanged ||
    status !== finding.status ||
    severity !== finding.severity ||
    (status === FindingStatus.needs_revision && revisionNote !== (finding.revisionNote ?? ''));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateFinding(finding.id, {
        content: contentChanged ? content : undefined,
        status: status !== finding.status ? status : undefined,
        severity: severity !== finding.severity ? severity : undefined,
        revisionNote: status === FindingStatus.needs_revision ? revisionNote || null : undefined,
      });
      toast.success(t('findings.updatedSuccess'));
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('findings.updateError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteFinding(finding.id);
      toast.success(t('findings.deletedSuccess'));
      setConfirmDeleteOpen(false);
      onDeleted?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('findings.deleteError'));
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (typeof window === 'undefined') return;
    const shareUrl = `${window.location.origin}/${organizationId}/overview/findings?open=${finding.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(t('findings.linkCopied'));
    } catch {
      toast.error(t('findings.copyLinkError'));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('findings.detailTitle')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <Stack gap="lg">
            <Stack gap="xs">
              <HStack justify="between" align="center">
                <HStack gap="xs" align="center">
                  <Badge variant="secondary">{t(SEVERITY_LABEL_KEYS[finding.severity])}</Badge>
                  <Badge variant="outline">{t(STATUS_LABEL_KEYS[finding.status])}</Badge>
                </HStack>
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={<Copy size={14} />}
                  onClick={handleCopyShareLink}
                >
                  {t('findings.copyLink')}
                </Button>
              </HStack>
              <Text size="sm" weight="medium">
                {targetLabel(finding)}
              </Text>
              {legacyScopeLabel && (
                <p className="text-xs text-muted-foreground">
                  {t('findings.originallyLoggedAgainst')}{' '}
                  <span className="font-medium text-foreground">{legacyScopeLabel}</span>
                </p>
              )}
              {href && (
                <Link
                  href={href}
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  {t('findings.openLinkedItem')}
                </Link>
              )}
            </Stack>

            <Stack gap="xs">
              <label className="text-sm font-medium">{t('findings.content')}</label>
              {canEditContent ? (
                <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} />
              ) : (
                <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm text-balance">
                  {finding.content}
                </p>
              )}
            </Stack>

            <HStack gap="sm">
              <div className="flex-1">
                <Stack gap="xs">
                  <label className="text-sm font-medium">{t('findings.severity')}</label>
                  <Select
                    value={severity}
                    onValueChange={(v) => v && setSeverity(v as FindingSeverity)}
                    disabled={!canUpdate}
                  >
                    <SelectTrigger>{t(SEVERITY_LABEL_KEYS[severity])}</SelectTrigger>
                    <SelectContent>
                      {SEVERITY_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(SEVERITY_LABEL_KEYS[s])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Stack>
              </div>
              <div className="flex-1">
                <Stack gap="xs">
                  <label className="text-sm font-medium">{t('common.status')}</label>
                  <Select
                    value={status}
                    onValueChange={(v) => v && setStatus(v as FindingStatus)}
                    disabled={!canUpdate}
                  >
                    <SelectTrigger>{t(STATUS_LABEL_KEYS[status])}</SelectTrigger>
                    <SelectContent>
                      {allowedStatusOptions({
                        current: status,
                        canCreateFindings,
                        isPlatformAdmin,
                      }).map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(STATUS_LABEL_KEYS[s])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Stack>
              </div>
            </HStack>

            {status === FindingStatus.needs_revision && (
              <Stack gap="xs">
                <label className="text-sm font-medium">{t('findings.revisionNote')}</label>
                <Textarea
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  rows={3}
                  placeholder={t('findings.revisionNotePlaceholder')}
                  disabled={!canUpdate}
                />
              </Stack>
            )}

            <HStack justify="between">
              {canDelete ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={deleting}
                >
                  {t('common.delete')}
                </Button>
              ) : (
                <span />
              )}
              <HStack gap="xs">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  disabled={!canUpdate || !isDirty || saving}
                  loading={saving}
                  onClick={handleSave}
                >
                  {t('common.save')}
                </Button>
              </HStack>
            </HStack>

            <Stack gap="xs">
              <Text size="sm" weight="medium">
                {t('findings.comments')}
              </Text>
              {finding ? (
                <Comments
                  entityId={finding.id}
                  entityType="finding"
                  organizationId={organizationId}
                  readOnly={!canUpdate}
                />
              ) : null}
            </Stack>

            <Stack gap="xs">
              <Text size="sm" weight="medium">
                {t('findings.activity')}
              </Text>
              {history.length === 0 ? (
                <Text size="xs" variant="muted">
                  {t('findings.noActivity')}
                </Text>
              ) : (
                <div className="divide-y divide-border rounded-md border border-border bg-muted/30">
                  {history.map((entry) => (
                    <div key={entry.id} className="p-3">
                      <p className="text-xs text-balance">
                        <strong>
                          {entry.user?.name || entry.user?.email || t('findings.someone')}
                        </strong>{' '}
                        {entry.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Stack>
          </Stack>
        </SheetBody>
      </SheetContent>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('findings.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('findings.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? t('findings.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
