'use client';

import { findingToAssetClass, remediationRoleName } from '@gideon-defender/integration-platform';
import { useRealtimeRun } from '@gideon-defender/trigger-react';
import { Badge } from '@gideon-defender/ui/badge';
import { Button } from '@gideon-defender/ui/button';
import { Checkbox } from '@gideon-defender/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  SkipForward,
  X,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  cancelBatchFix,
  retryFinding,
  skipBatchFinding,
  startBatchFix,
} from '../actions/batch-fix';
import { buildFindingPermissionsScript, isGuidanceOnlyScript } from '../lib/batch-merge-script';
import { formatBlockedActionsForDisplay } from '../lib/remediation-denylist';

interface Finding {
  id: string;
  title: string | null;
  key: string;
  severity: string;
  resourceType?: string | null;
  region?: string | null;
}

interface BatchRemediationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceName: string;
  findings: Finding[];
  connectionId: string;
  organizationId: string;
  onComplete?: () => void;
  /** Called when the trigger run starts — parent uses this to enable the floating pill. */
  onRunStarted?: (info: { batchId: string; triggerRunId: string; accessToken: string }) => void;
  /** Resume an active batch (loaded on page mount). */
  activeBatch?: {
    batchId: string;
    triggerRunId: string;
    accessToken: string;
    findings: Array<{ id: string; title: string; status: string; error?: string }>;
  } | null;
}

type FindingStatus =
  'pending' | 'fixing' | 'fixed' | 'needs_permissions' | 'skipped' | 'failed' | 'cancelled';

interface FindingProgress {
  id: string;
  key?: string;
  title: string;
  severity?: string;
  status: FindingStatus;
  error?: string;
  missingPermissions?: string[];
}

interface BatchProgress {
  current: number;
  total: number;
  fixed: number;
  skipped: number;
  failed: number;
  findings: FindingProgress[];
  phase: 'running' | 'retrying' | 'scanning' | 'waiting_for_permissions' | 'done' | 'cancelled';
  permChecksLeft?: number;
}

const STATUS_CONFIG: Record<FindingStatus, { icon: typeof Check; color: string; bg: string }> = {
  pending: { icon: Loader2, color: 'text-muted-foreground/40', bg: '' },
  fixing: { icon: Loader2, color: 'text-primary', bg: 'bg-primary/[0.04]' },
  fixed: { icon: Check, color: 'text-emerald-500', bg: '' },
  needs_permissions: { icon: ShieldAlert, color: 'text-muted-foreground', bg: '' },
  skipped: { icon: SkipForward, color: 'text-muted-foreground', bg: '' },
  failed: { icon: X, color: 'text-red-500', bg: '' },
  cancelled: { icon: X, color: 'text-muted-foreground', bg: '' },
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-blue-400',
  info: 'bg-gray-300',
};

/** Per-finding inline permissions with copy/cloudshell/retry. */
function FindingPermissions({
  permissions,
  resourceType,
  region,
  onRetry,
}: {
  permissions: string[];
  resourceType?: string | null;
  region?: string | null;
  onRetry: () => void;
}) {
  const t = useTranslations('integrations.list');
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Scope the grant script to the finding's routed pair role when both
  // inputs are known; legacy monolith default otherwise (same fallback
  // the server applies when no pair map covers the finding).
  const roleName = useMemo(() => {
    if (!resourceType || !region?.trim()) return undefined;
    try {
      return remediationRoleName({
        assetClass: findingToAssetClass(resourceType),
        region: region.trim(),
      });
    } catch {
      return undefined;
    }
  }, [resourceType, region]);

  const {
    script,
    blocked: blockedPermissions,
    grantable,
  } = useMemo(() => buildFindingPermissionsScript(permissions, roleName), [permissions, roleName]);

  // Group grantable actions only — blocked actions surface in the manual
  // review warning below, never as required chips (same as PermissionErrorPanel).
  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const p of grantable) {
      const [svc, action] = p.split(':');
      if (svc && action) (groups[svc] ??= []).push(action);
    }
    return groups;
  }, [grantable]);
  // Guidance-only when every action needs manual review — nothing to run,
  // so copy/CloudShell buttons stay hidden (same as PermissionErrorPanel).
  const guidanceOnly = isGuidanceOnlyScript(script);

  return (
    <div className="ml-[30px] mt-1.5 space-y-1.5">
      {blockedPermissions.length > 0 && (
        <p className="text-[10px] leading-relaxed text-amber-700 dark:text-amber-400">
          {blockedPermissions.length} permission(s) need manual review and are excluded from the
          script:{' '}
          <code className="font-mono">{formatBlockedActionsForDisplay(blockedPermissions)}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {Object.entries(grouped).map(([svc, actions]) => (
          <div key={svc} className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground font-medium">{svc}:</span>
            {actions.map((a) => (
              <span
                key={a}
                className="rounded bg-muted px-1 py-0.5 text-[9px] font-mono text-foreground/70"
              >
                {a}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {!guidanceOnly && (
          <>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(script).then(
                  () => {
                    setCopied(true);
                    toast.success(t('cloudTests_batchScriptCopied'));
                    setTimeout(() => setCopied(false), 2000);
                  },
                  () => {
                    toast.error('Copy failed — select and copy manually');
                  },
                );
              }}
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? (
                <Check className="h-2.5 w-2.5 text-emerald-500" />
              ) : (
                <Copy className="h-2.5 w-2.5" />
              )}
              {copied ? t('cloudTests_batchCopied') : t('cloudTests_batchCopy')}
            </button>
            <a
              href="https://console.aws.amazon.com/cloudshell"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              CloudShell
            </a>
          </>
        )}
        <button
          type="button"
          onClick={async () => {
            setRetrying(true);
            try {
              await onRetry();
            } finally {
              setRetrying(false);
            }
          }}
          disabled={retrying}
          className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          {retrying ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <RefreshCw className="h-2.5 w-2.5" />
          )}
          {retrying ? t('cloudTests_batchRetryingShort') : t('cloudTests_batchRetry')}
        </button>
      </div>
    </div>
  );
}

export function BatchRemediationDialog({
  open,
  onOpenChange,
  serviceName,
  findings,
  connectionId,
  organizationId,
  onComplete,
  onRunStarted,
  activeBatch,
}: BatchRemediationDialogProps) {
  const t = useTranslations('integrations.list');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Resume active batch if provided
  const [prevResumeBatch, setPrevResumeBatch] = useState(activeBatch);
  const [prevResumeOpen, setPrevResumeOpen] = useState(open);
  if (prevResumeBatch !== activeBatch || prevResumeOpen !== open) {
    setPrevResumeBatch(activeBatch);
    setPrevResumeOpen(open);
    if (activeBatch && open) {
      setBatchId(activeBatch.batchId);
      setRunId(activeBatch.triggerRunId);
      setAccessToken(activeBatch.accessToken);
    }
  }

  // Real-time task progress
  const { run } = useRealtimeRun(runId ?? '', {
    accessToken: accessToken ?? undefined,
    enabled: Boolean(runId && accessToken),
  });

  const progress = (run?.metadata as { progress?: BatchProgress } | undefined)?.progress ?? null;

  // Detect if the trigger run itself is finished (cancelled, failed, completed)
  const runStatus = run?.status;
  const runFinished =
    runStatus === 'COMPLETED' ||
    runStatus === 'FAILED' ||
    runStatus === 'CANCELED' ||
    runStatus === 'SYSTEM_FAILURE';

  const isRunning =
    Boolean(runId) &&
    !runFinished &&
    (!progress || progress.phase === 'running' || progress.phase === 'retrying');
  const isWaitingPerms = progress?.phase === 'waiting_for_permissions';
  const isScanning = progress?.phase === 'scanning';
  const isDone = progress?.phase === 'done' || progress?.phase === 'cancelled' || runFinished;

  // Reset on open — selection only. Never touch an in-flight or finished
  // run: completion triggers a findings refresh (mutate) while the dialog
  // is still open, and clearing runId/batchId there drops the Done view.
  const [prevResetOpen, setPrevResetOpen] = useState(open);
  const [prevResetFindings, setPrevResetFindings] = useState(findings);
  const [prevResetBatch, setPrevResetBatch] = useState(activeBatch);
  if (prevResetOpen !== open || prevResetFindings !== findings || prevResetBatch !== activeBatch) {
    setPrevResetOpen(open);
    setPrevResetFindings(findings);
    setPrevResetBatch(activeBatch);
    if (open && !activeBatch && !runId && !batchId) {
      setSelected(new Set(findings.map((f) => f.id)));
      setAcknowledged(false);
      setBatchId(null);
      setRunId(null);
      setAccessToken(null);
      setCancelling(false);
    }
  }

  // Auto-complete + auto-close when all findings are fixed. Guarded to run
  // once — progress metadata is recreated per poll, so without the ref this
  // re-fires on every identity change and stacks close timers.
  const completedRef = useRef(false);
  useEffect(() => {
    completedRef.current = false;
  }, [runId, batchId]);
  useEffect(() => {
    if (isDone && progress && progress.fixed > 0 && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
      // Auto-close if everything succeeded (no failures or skips)
      const allFixed = progress.failed === 0 && progress.skipped === 0;
      if (allFixed) {
        const timer = setTimeout(() => onOpenChange(false), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [isDone, progress, onComplete, onOpenChange, runId, batchId]);

  // Findings with progress (from task metadata or initial list)
  const findingsWithProgress = useMemo((): FindingProgress[] => {
    if (progress?.findings) return progress.findings;
    if (activeBatch?.findings) {
      return activeBatch.findings.map((f) => ({
        id: f.id,
        title: f.title,
        status: (f.status as FindingStatus) || 'pending',
        error: f.error,
      }));
    }
    if (runId) {
      return findings
        .filter((f) => selected.has(f.id))
        .map((f) => ({
          id: f.id,
          title: f.title ?? t('cloudTests_batchUntitledFinding'),
          status: 'pending' as FindingStatus,
        }));
    }
    return [];
  }, [progress, runId, findings, selected, activeBatch, t]);

  const handleToggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    if (selected.size === findings.length) setSelected(new Set());
    else setSelected(new Set(findings.map((f) => f.id)));
  }, [selected.size, findings]);

  const handleStart = async () => {
    const selectedFindings = findings
      .filter((f) => selected.has(f.id))
      .map((f) => ({
        id: f.id,
        key: f.key,
        title: f.title ?? t('cloudTests_batchUntitledFinding'),
      }));
    if (selectedFindings.length === 0) return;

    setStarting(true);
    const result = await startBatchFix({
      organizationId,
      connectionId,
      findings: selectedFindings,
    });
    setStarting(false);

    if (result.error || !result.data) return;

    setBatchId(result.data.batchId);
    setRunId(result.data.runId);
    setAccessToken(result.data.accessToken);
    onRunStarted?.({
      batchId: result.data.batchId,
      triggerRunId: result.data.runId,
      accessToken: result.data.accessToken,
    });
  };

  const handleCancel = async () => {
    if (!runId || !batchId) return;
    setCancelling(true);
    try {
      await cancelBatchFix(runId, batchId);
    } finally {
      setCancelling(false);
    }
  };

  const handleSkipFinding = async (findingId: string) => {
    if (!batchId) return;
    await skipBatchFinding(batchId, findingId);
  };

  // Retry: create a new batch with only the skipped/failed/needs_permissions findings
  const handleRetrySkipped = async () => {
    const retryFindings = findingsWithProgress
      .filter(
        (f) => f.status === 'skipped' || f.status === 'failed' || f.status === 'needs_permissions',
      )
      .map((f) => {
        const orig = findings.find((o) => o.id === f.id);
        return orig
          ? {
              id: orig.id,
              key: orig.key,
              title: orig.title ?? t('cloudTests_batchUntitledFinding'),
            }
          : null;
      })
      .filter((f): f is { id: string; key: string; title: string } => f !== null);

    if (retryFindings.length === 0) return;

    setStarting(true);
    const result = await startBatchFix({ organizationId, connectionId, findings: retryFindings });
    setStarting(false);

    if (result.error || !result.data) return;

    setBatchId(result.data.batchId);
    setRunId(result.data.runId);
    setAccessToken(result.data.accessToken);
    onRunStarted?.({
      batchId: result.data.batchId,
      triggerRunId: result.data.runId,
      accessToken: result.data.accessToken,
    });
  };

  const handleClose = () => {
    // Allow close even while running — task continues in background
    onOpenChange(false);
  };

  const selectedCount = selected.size;
  const allSelected = selectedCount === findings.length;
  const pct =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const hasSkippedOrFailed = findingsWithProgress.some(
    (f) => f.status === 'skipped' || f.status === 'failed' || f.status === 'needs_permissions',
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="w-full max-h-[85vh] overflow-hidden flex flex-col"
        style={{ maxWidth: '32rem' }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            {t('cloudTests_batchFixAllTitle', { serviceName })}
          </DialogTitle>
          <DialogDescription>
            {runId
              ? t('cloudTests_batchProcessingFindings', {
                  count: progress?.total ?? selectedCount,
                })
              : t('cloudTests_batchSelectedForAutoFix', { count: selectedCount })}
          </DialogDescription>
        </DialogHeader>

        {/* ─── Pre-start: Selection ─── */}
        {!runId && (
          <>
            <div className="flex items-center gap-2 border-b pb-2">
              <Checkbox checked={allSelected} onCheckedChange={handleToggleAll} id="select-all" />
              <label
                htmlFor="select-all"
                className="text-xs font-medium text-muted-foreground cursor-pointer select-none"
              >
                {allSelected ? t('cloudTests_batchDeselectAll') : t('cloudTests_batchSelectAll')}
              </label>
              <span className="ml-auto text-xs text-muted-foreground">
                {t('cloudTests_batchSelectedCount', { count: selectedCount })}
              </span>
            </div>

            <div className="overflow-y-auto max-h-[40vh] -mx-1 px-1 space-y-0.5">
              {findings.map((f) => (
                <label
                  key={f.id}
                  className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-muted/40 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={selected.has(f.id)}
                    onCheckedChange={() => handleToggle(f.id)}
                  />
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[f.severity.toLowerCase()] ?? 'bg-gray-300'}`}
                  />
                  <span className="text-sm truncate min-w-0 flex-1">
                    {f.title ?? t('cloudTests_batchUntitledFinding')}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[9px]">
                    {f.severity}
                  </Badge>
                </label>
              ))}
            </div>

            <div className="space-y-3 border-t pt-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(v) => setAcknowledged(v === true)}
                  className="mt-0.5"
                />
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {t('cloudTests_batchAcknowledgeBody')}
                </span>
              </label>
              <Button
                onClick={handleStart}
                disabled={!acknowledged || selectedCount === 0 || starting}
                className="w-full"
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                {starting
                  ? t('cloudTests_batchStarting')
                  : t('cloudTests_batchFixCount', { count: selectedCount })}
              </Button>
            </div>
          </>
        )}

        {/* ─── In-progress / Done ─── */}
        {runId && (
          <>
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${isDone ? 'bg-emerald-500' : 'bg-primary'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {isScanning
                    ? t('cloudTests_batchRescanning')
                    : isDone
                      ? progress?.phase === 'cancelled'
                        ? t('cloudTests_batchCancelled')
                        : t('cloudTests_batchComplete')
                      : isWaitingPerms
                        ? t('cloudTests_batchWaitingForPerms', {
                            count: progress?.permChecksLeft ?? 0,
                          })
                        : progress?.phase === 'retrying'
                          ? t('cloudTests_batchRetryingWithPerms')
                          : t('cloudTests_batchFixingProgress', {
                              current: progress?.current ?? 0,
                              total: progress?.total ?? selectedCount,
                            })}
                </span>
                <div className="flex gap-3">
                  {(progress?.fixed ?? 0) > 0 && (
                    <span className="text-emerald-600">
                      {t('cloudTests_batchFixedCount', { count: progress!.fixed })}
                    </span>
                  )}
                  {(progress?.skipped ?? 0) > 0 && (
                    <span className="text-amber-600">
                      {t('cloudTests_batchSkippedCount', { count: progress!.skipped })}
                    </span>
                  )}
                  {(progress?.failed ?? 0) > 0 && (
                    <span className="text-red-600">
                      {t('cloudTests_batchFailedCount', { count: progress!.failed })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Finding progress list */}
            <div className="overflow-y-auto max-h-[45vh] -mx-1 px-1 space-y-0.5">
              {findingsWithProgress.map((f) => {
                const config = STATUS_CONFIG[f.status] ?? STATUS_CONFIG.pending;
                const Icon = config.icon;
                const canSkip = f.status === 'pending' && !isDone;
                const isMissingPerms =
                  f.status === 'needs_permissions' &&
                  f.missingPermissions &&
                  f.missingPermissions.length > 0;

                return (
                  <div
                    key={f.id}
                    className={`group rounded-md px-2.5 py-2 transition-all duration-300 ${config.bg}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                        <Icon
                          className={`h-3.5 w-3.5 ${config.color} ${f.status === 'fixing' ? 'animate-spin' : ''}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm truncate ${f.status === 'fixing' ? 'font-medium' : f.status === 'pending' ? 'text-muted-foreground' : ''}`}
                        >
                          {f.title}
                        </p>
                        {f.error && !isMissingPerms && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {f.error}
                          </p>
                        )}
                      </div>
                      {canSkip && (
                        <button
                          type="button"
                          onClick={() => handleSkipFinding(f.id)}
                          className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                          title={t('cloudTests_batchSkipFindingTooltip')}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                      {f.status === 'fixed' && (
                        <span className="text-[10px] text-emerald-600 font-medium shrink-0">
                          {t('cloudTests_batchDone')}
                        </span>
                      )}
                      {f.status === 'cancelled' && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {t('cloudTests_batchRemoved')}
                        </span>
                      )}
                    </div>
                    {/* Per-finding permissions — only shows for THIS finding */}
                    {isMissingPerms && (
                      <FindingPermissions
                        permissions={f.missingPermissions!}
                        resourceType={findings.find((o) => o.id === f.id)?.resourceType}
                        region={findings.find((o) => o.id === f.id)?.region}
                        onRetry={async () => {
                          // Find the original finding data for key
                          const orig = findings.find((o) => o.id === f.id);
                          if (!orig) return;
                          const result = await retryFinding(connectionId, f.id, orig.key);
                          if (result.status === 'fixed') {
                            toast.success(t('cloudTests_batchFixedToast', { title: f.title }));
                            onComplete?.();
                          } else if (result.status === 'needs_permissions') {
                            toast.error(t('cloudTests_batchStillMissingPerms'));
                          } else {
                            toast.error(result.error ?? t('cloudTests_batchRetryFailed'));
                          }
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t pt-3">
              {!isDone && !isScanning && (
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>
                  {cancelling ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  ) : (
                    <X className="h-3 w-3 mr-1.5" />
                  )}
                  {cancelling ? t('cloudTests_batchCancelling') : t('cloudTests_batchCancelAll')}
                </Button>
              )}
              {isScanning && (
                <Button variant="outline" size="sm" disabled>
                  <RefreshCw className="h-3 w-3 animate-spin mr-1.5" />
                  {t('cloudTests_batchRescanningButton')}
                </Button>
              )}
              {isDone && hasSkippedOrFailed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetrySkipped}
                  disabled={starting}
                >
                  {starting ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1.5" />
                  )}
                  {t('cloudTests_batchRetrySkipped')}
                </Button>
              )}
              {isDone && (
                <Button size="sm" onClick={() => onOpenChange(false)}>
                  {t('cloudTests_batchDone')}
                </Button>
              )}
              {!isDone && (
                <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                  {t('cloudTests_batchMinimize')}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
