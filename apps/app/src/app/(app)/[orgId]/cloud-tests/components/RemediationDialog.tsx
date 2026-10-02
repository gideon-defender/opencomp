'use client';

import { useRealtimeRun } from '@gideon-defender/trigger-react';
import { Badge } from '@gideon-defender/ui/badge';
import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import { AlertTriangle, ListOrdered, Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { startPreview, startSingleFix } from '../actions/single-fix';
import { formatBlockedActionsForDisplay } from '../lib/remediation-denylist';
import { extractJsonSegments } from './extract-json-segments';
import { PermissionErrorPanel } from './PermissionErrorPanel';

interface PreviewProgress {
  phase: 'analyzing' | 'complete' | 'failed';
  error?: string;
  preview?: PreviewData;
}

interface SingleFixProgress {
  phase: 'executing' | 'success' | 'failed' | 'needs_permissions' | 'manual';
  error?: string;
  actionId?: string;
  permissionError?: {
    missingActions: string[];
    fixScript?: string;
    blockedPermissions?: string[];
    blockedPermissionsMessage?: string;
  };
  guidedSteps?: string[];
}

interface RemediationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  checkResultId: string;
  remediationKey: string;
  findingTitle: string;
  providerSlug?: string;
  guidedOnly?: boolean;
  guidedSteps?: string[];
  risk?: string;
  description?: string;
  /**
   * True when the underlying finding came from AWS Security Hub rather
   * than one of our service adapters. Surfaces a disclosure banner —
   * SecHub remediation text quality varies and SecHub re-evaluates
   * findings on its own schedule, so the customer should verify in the
   * AWS console after applying.
   */
  fromSecurityHub?: boolean;
  onComplete?: () => void;
}

interface PreviewData {
  currentState: Record<string, unknown>;
  proposedState: Record<string, unknown>;
  description: string;
  risk: string;
  apiCalls: string[];
  requiresAcknowledgment?: 'type-to-confirm' | 'checkbox';
  acknowledgmentMessage?: string;
  confirmationPhrase?: string;
  guidedOnly?: boolean;
  guidedSteps?: string[];
  rollbackSupported?: boolean;
  missingPermissions?: string[];
  permissionFixScript?: string;
  allRequiredPermissions?: string[];
  blockedPermissions?: string[];
  blockedPermissionsMessage?: string;
  needsFreshPreview?: string;
}

const RISK_STYLES: Record<string, string> = {
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-yellow-200 bg-yellow-50 text-yellow-700',
  high: 'border-red-200 bg-red-50 text-red-700',
  critical: 'border-purple-200 bg-purple-50 text-purple-700',
};

// ─── Helper components (must be declared before RemediationDialog) ──────

function RichText({ text }: { text: string }) {
  const urlRegex = /(https?:\/\/[^\s)]+)/g;
  const parts = text.split(urlRegex);
  if (parts.length === 1) {
    return <p className="text-muted-foreground leading-relaxed">{text}</p>;
  }
  return (
    <p className="text-muted-foreground leading-relaxed">
      {parts.map((part, i) =>
        part.match(urlRegex) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80 break-all"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

/**
 * Disclosure shown in the Fix dialog when the underlying finding came
 * from AWS Security Hub. Two things customers need to know that aren't
 * true for our own adapter findings:
 *
 *   1. AI fix plans are generated from AWS's remediation text, which
 *      varies in specificity. The plan may need adjustment after
 *      reviewing in the AWS console.
 *   2. Security Hub re-evaluates findings on its own schedule (hours,
 *      not minutes). After a successful Fix, the SecHub-side finding
 *      may take time to clear even though the underlying issue is gone.
 */
function SecurityHubFixDisclosure() {
  const t = useTranslations('integrations.list');
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
      <p className="font-medium">{t('cloudTests_securityHubFindingTitle')}</p>
      <p className="mt-1 leading-relaxed">{t('cloudTests_securityHubFindingBody')}</p>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const t = useTranslations('integrations.list');
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Non-secure context or denied permission — leave the code visible
        // for manual selection instead of an unhandled rejection.
      });
  };
  return (
    <div className="group relative rounded-md border bg-muted/50">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded border bg-background text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
        title={t('cloudTests_copyToClipboard')}
      >
        {copied ? (
          <svg
            className="h-3 w-3 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        )}
      </button>
      <pre className="overflow-x-auto px-3 py-2 pr-9 text-[11px] font-mono leading-relaxed text-foreground whitespace-pre-wrap break-words">
        {code}
      </pre>
    </div>
  );
}

function TextSegment({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  const rendered: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (part.startsWith('`') && part.endsWith('`')) {
      const code = part.slice(1, -1);
      if (code.length > 60 || code.startsWith('aws ') || code.includes(' --')) {
        rendered.push(<CodeBlock key={`cb${i}`} code={code} />);
      } else {
        rendered.push(
          <code
            key={`ic${i}`}
            className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono text-foreground"
          >
            {code}
          </code>,
        );
      }
    } else if (part.trim()) {
      rendered.push(<RichText key={`rt${i}`} text={part} />);
    }
  }
  return <>{rendered}</>;
}

function TextWithInlineCode({ text }: { text: string }) {
  // Brace-balanced scan via `extractJsonSegments`. Replaces the
  // previous regex which only handled one level of nesting and
  // mis-split policies with both Principal:{...} and
  // Condition.StringEquals:{...}. See extract-json-segments.test.ts.
  const segments = extractJsonSegments(text);
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.type === 'json') {
          return <CodeBlock key={`json${i}`} code={segment.pretty} />;
        }
        if (!segment.value.trim()) return null;
        return <TextSegment key={`seg${i}`} text={segment.value} />;
      })}
    </>
  );
}

function StepContent({ text }: { text: string }) {
  const tripleBacktickParts = text.split(/(```[\s\S]*?```)/g);
  if (tripleBacktickParts.length > 1) {
    return (
      <>
        {tripleBacktickParts.map((part, i) => {
          if (part.startsWith('```') && part.endsWith('```')) {
            return (
              <CodeBlock
                key={i}
                code={part
                  .slice(3, -3)
                  .replace(/^\w*\n?/, '')
                  .trim()}
              />
            );
          }
          const trimmed = part.trim();
          if (!trimmed) return null;
          return <TextWithInlineCode key={i} text={trimmed} />;
        })}
      </>
    );
  }
  return <TextWithInlineCode text={text} />;
}

function StateBlock({ label, state }: { label: string; state: Record<string, unknown> }) {
  return (
    <div className="min-w-0 rounded-md border p-2.5 overflow-hidden">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <pre className="text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
        {JSON.stringify(state, null, 2)}
      </pre>
    </div>
  );
}

/** Animated loading steps that show progress during analysis. */
function LoadingSteps({ providerSlug }: { providerSlug?: string }) {
  const t = useTranslations('integrations.list');
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 1500),
      setTimeout(() => setStep(2), 4000),
      setTimeout(() => setStep(3), 7000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const providerName = providerSlug === 'gcp' ? 'GCP' : providerSlug === 'azure' ? 'Azure' : 'AWS';
  const steps = [
    { label: t('cloudTests_stepAnalyzing'), sub: t('cloudTests_stepAnalyzingSub') },
    {
      label: t('cloudTests_stepReadingConfig', { provider: providerName }),
      sub: t('cloudTests_stepReadingConfigSub'),
    },
    {
      label: t('cloudTests_stepCheckingPermissions'),
      sub: t('cloudTests_stepCheckingPermissionsSub'),
    },
    { label: t('cloudTests_stepPreparingFix'), sub: t('cloudTests_stepPreparingFixSub') },
  ];

  const progress = ((step + 1) / steps.length) * 100;

  return (
    <div className="py-8 px-1">
      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-muted mb-8 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="space-y-1">
        {steps.map(({ label, sub }, i) => {
          const done = i < step;
          const active = i === step;
          const pending = i > step;

          return (
            <div
              key={i}
              className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-all duration-500 ${
                active ? 'bg-primary/[0.04]' : ''
              } ${pending ? 'opacity-40' : 'opacity-100'}`}
            >
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                {done ? (
                  <svg
                    className="h-5 w-5 text-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <div className="h-1.5 w-1.5 rounded-full bg-border" />
                )}
              </div>
              <div className="min-w-0">
                <p
                  className={`text-sm leading-tight ${active ? 'font-medium text-foreground' : done ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}
                >
                  {label}
                </p>
                {active && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────

export function RemediationDialog({
  open,
  onOpenChange,
  connectionId,
  checkResultId,
  remediationKey,
  findingTitle,
  providerSlug,
  guidedOnly,
  guidedSteps,
  risk,
  description,
  fromSecurityHub,
  onComplete,
}: RemediationDialogProps) {
  const t = useTranslations('integrations.list');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isWaitingPropagation, setIsWaitingPropagation] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<{
    missingActions: string[];
    fixScript?: string;
    blockedPermissions?: string[];
    blockedPermissionsMessage?: string;
  } | null>(null);
  const [acknowledgment, setAcknowledgment] = useState<string | null>(null);

  // Local trigger state for preview (async)
  const [previewRunId, setPreviewRunId] = useState<string | null>(null);
  const [previewAccessToken, setPreviewAccessToken] = useState<string | null>(null);

  // Local trigger state for execute (async)
  const [executeRunId, setExecuteRunId] = useState<string | null>(null);
  const [executeAccessToken, setExecuteAccessToken] = useState<string | null>(null);

  const { run: previewRun } = useRealtimeRun(previewRunId ?? '', {
    accessToken: previewAccessToken ?? undefined,
    enabled: Boolean(previewRunId && previewAccessToken),
  });

  const { run: executeRun } = useRealtimeRun(executeRunId ?? '', {
    accessToken: executeAccessToken ?? undefined,
    enabled: Boolean(executeRunId && executeAccessToken),
  });

  // Ref to store permissions across rechecks (avoids stale closure in useCallback)
  const permissionsRef = useRef<string[] | undefined>(undefined);
  // Set while the retry propagation wait sleeps — close cancels the wait so
  // no fix starts for a closed dialog.
  const retryCancelledRef = useRef(false);
  useEffect(() => {
    if (!open) retryCancelledRef.current = true;
    else retryCancelledRef.current = false;
  }, [open]);

  // Watch preview task progress
  useEffect(() => {
    const progress = (previewRun?.metadata as { progress?: PreviewProgress } | undefined)?.progress;
    if (!progress || progress.phase === 'analyzing') return;

    // Defer state updates out of the synchronous effect body — the realtime
    // subscription delivers progress here, the microtask applies it.
    queueMicrotask(() => {
      if (progress.phase === 'complete' && progress.preview) {
        const previewData = progress.preview as unknown as PreviewData;
        setPreview(previewData);
        if (previewData.allRequiredPermissions) {
          permissionsRef.current = previewData.allRequiredPermissions;
        }
        setIsLoadingPreview(false);
        setPreviewRunId(null);
        setPreviewAccessToken(null);
      } else if (progress.phase === 'failed') {
        setError(progress.error || t('cloudTests_failedToLoadPreview'));
        setIsLoadingPreview(false);
        setPreviewRunId(null);
        setPreviewAccessToken(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewRun?.metadata]);

  // Watch execute task progress
  useEffect(() => {
    const progress = (executeRun?.metadata as { progress?: SingleFixProgress } | undefined)
      ?.progress;
    if (!progress || progress.phase === 'executing') return;

    // Defer state updates out of the synchronous effect body — the realtime
    // subscription delivers progress here, the microtask applies it.
    queueMicrotask(() => {
      if (progress.phase === 'success') {
        setIsExecuting(false);
        setPreview(null);
        setError(null);
        setSucceeded(true);
        toast.success(t('cloudTests_fixApplied'));
        onComplete?.();
        setTimeout(() => {
          onOpenChange(false);
          setSucceeded(false);
          setExecuteRunId(null);
          setExecuteAccessToken(null);
        }, 4000);
      } else if (progress.phase === 'manual') {
        // Auto-fix gave up but the API returned real manual steps.
        // Switch the dialog into guided rendering instead of showing a
        // raw error — same UI the preview flow already uses for
        // canAutoFix:false plans.
        setIsExecuting(false);
        setError(null);
        const steps = progress.guidedSteps ?? [];
        setPreview({
          currentState: {},
          proposedState: {},
          description: progress.error ?? description ?? '',
          risk: risk ?? 'medium',
          apiCalls: [],
          guidedOnly: true,
          guidedSteps: steps,
          rollbackSupported: false,
        });
        setExecuteRunId(null);
        setExecuteAccessToken(null);
      } else if (progress.phase === 'failed') {
        setIsExecuting(false);
        setError(progress.error || t('cloudTests_remediationFailed'));
        setExecuteRunId(null);
        setExecuteAccessToken(null);
      } else if (progress.phase === 'needs_permissions') {
        setIsExecuting(false);
        setError(progress.error || t('cloudTests_missingPermissions'));
        if (progress.permissionError) {
          setPermissionError(progress.permissionError);
        }
        setExecuteRunId(null);
        setExecuteAccessToken(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeRun?.metadata]);

  const loadPreview = useCallback(
    async (recheck = false) => {
      setIsLoadingPreview(true);
      setError(null);
      try {
        const result = await startPreview({
          connectionId,
          checkResultId,
          remediationKey,
          ...(recheck &&
            permissionsRef.current && {
              cachedPermissions: permissionsRef.current,
            }),
        });
        if (result.error || !result.data) {
          setError(result.error || t('cloudTests_failedToLoadPreview'));
          setIsLoadingPreview(false);
          return;
        }
        // Task started — preview effect handles the rest
        setPreviewRunId(result.data.runId);
        setPreviewAccessToken(result.data.accessToken);
      } catch {
        setError(t('cloudTests_failedToLoadPreview'));
        setIsLoadingPreview(false);
      }
    },
    [connectionId, checkResultId, remediationKey],
  );

  // Reset dialog state when a new remediation is opened — applied during render
  // so the fresh state is in place before paint, without a cascading effect.
  // Tracks the full finding identity: the same remediationKey recurs across
  // findings, so keying on it alone shows finding A's preview for finding B.
  const [prevDialogReset, setPrevDialogReset] = useState({
    open,
    remediationKey,
    checkResultId,
    connectionId,
  });
  if (
    prevDialogReset.open !== open ||
    prevDialogReset.remediationKey !== remediationKey ||
    prevDialogReset.checkResultId !== checkResultId ||
    prevDialogReset.connectionId !== connectionId
  ) {
    setPrevDialogReset({ open, remediationKey, checkResultId, connectionId });
    if (open) {
      setError(null);
      setPermissionError(null);
      setAcknowledgment(null);
      setPreviewRunId(null);
      setPreviewAccessToken(null);
      setExecuteRunId(null);
      setExecuteAccessToken(null);
      setSucceeded(false);
      // A close mid-execute must not leak the spinner into the next open —
      // the background task continues, but this dialog starts idle.
      setIsExecuting(false);
      setIsWaitingPropagation(false);
      setIsLoadingPreview(false);

      // Guided-only: skip API call, use local data
      if (guidedOnly && guidedSteps) {
        setPreview({
          currentState: {},
          proposedState: {},
          description: description ?? '',
          risk: risk ?? 'medium',
          apiCalls: [],
          guidedOnly: true,
          guidedSteps,
          rollbackSupported: false,
        });
      } else {
        setPreview(null);
        setIsLoadingPreview(true);
      }
    }
  }

  useEffect(() => {
    if (!open) return;

    // Guided-only: skip API call, local data was already set during render
    if (guidedOnly && guidedSteps) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await startPreview({
          connectionId,
          checkResultId,
          remediationKey,
        });
        if (cancelled) return;
        if (result.error || !result.data) {
          setError(result.error || t('cloudTests_failedToLoadPreview'));
          setIsLoadingPreview(false);
          return;
        }
        // Task started — preview effect handles the rest
        setPreviewRunId(result.data.runId);
        setPreviewAccessToken(result.data.accessToken);
      } catch {
        if (cancelled) return;
        setError(t('cloudTests_failedToLoadPreview'));
        setIsLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, remediationKey, checkResultId, connectionId]);

  const handleExecute = async () => {
    setIsExecuting(true);
    setError(null);
    setPermissionError(null);
    try {
      const result = await startSingleFix({
        connectionId,
        checkResultId,
        remediationKey,
        acknowledgment: acknowledgment ?? undefined,
      });
      if (result.error || !result.data) {
        setError(result.error || t('cloudTests_failedToStartFix'));
        setIsExecuting(false);
        return;
      }
      // Task started — execute effect handles the rest
      setExecuteRunId(result.data.runId);
      setExecuteAccessToken(result.data.accessToken);
    } catch {
      setError(t('cloudTests_failedToStartFix'));
      setIsExecuting(false);
    }
  };

  const handleRetry = async () => {
    retryCancelledRef.current = false;
    setIsWaitingPropagation(true);
    // IAM permission changes take up to 10s to propagate in AWS
    await new Promise((r) => setTimeout(r, 10_000));
    if (retryCancelledRef.current) return;
    setIsWaitingPropagation(false);
    await handleExecute();
  };

  const isGuided = preview?.guidedOnly;
  // An auto-fix plan with no API calls has nothing to apply (the AI returned
  // an empty/unusable plan). Block Apply so the user can't submit a no-op that
  // fails server-side — they can Cancel and re-open to regenerate.
  const hasNothingToApply = !isGuided && (preview?.apiCalls?.length ?? 0) === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-full max-h-[85vh] overflow-y-auto transition-[max-width] duration-300"
        style={{ maxWidth: preview && !isLoadingPreview && !succeeded ? '48rem' : '28rem' }}
      >
        <div className="min-w-0 overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {isGuided ? t('cloudTests_remediateTitle') : t('cloudTests_autoRemediateTitle')}
            </DialogTitle>
            <DialogDescription className="line-clamp-2">{findingTitle}</DialogDescription>
          </DialogHeader>

          {fromSecurityHub && <SecurityHubFixDisclosure />}

          <div className="space-y-3 min-w-0">
            {/* Applying state — shown while executing */}
            {isExecuting && !succeeded && !error && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Loader2 className="h-6 w-6 text-primary animate-spin" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">{t('cloudTests_applyingFix')}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('cloudTests_applyingFixDescription')}
                  </p>
                </div>
              </div>
            )}

            {/* Success state */}
            {succeeded && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <svg
                    className="h-6 w-6 text-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">{t('cloudTests_fixApplied')}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t('cloudTests_rescanning')}</p>
                </div>
              </div>
            )}

            {isLoadingPreview &&
              !succeeded &&
              (preview ? (
                /* Recheck — just verifying permissions */
                <div className="flex items-center justify-center py-6 gap-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    {t('cloudTests_verifyingPermissions')}
                  </p>
                </div>
              ) : (
                /* First load — full analysis */
                <LoadingSteps providerSlug={providerSlug} />
              ))}

            {error && !succeeded && (
              <PermissionErrorPanel
                error={error}
                missingActions={permissionError?.missingActions}
                fixScript={permissionError?.fixScript}
                blockedPermissions={permissionError?.blockedPermissions}
                blockedPermissionsMessage={permissionError?.blockedPermissionsMessage}
                apiCalls={preview?.apiCalls}
                onRetry={handleRetry}
                isRetrying={isExecuting}
                isWaiting={isWaitingPropagation}
                provider={
                  providerSlug === 'azure' || providerSlug === 'gcp' || providerSlug === 'aws'
                    ? providerSlug
                    : undefined
                }
              />
            )}

            {preview && !isLoadingPreview && (
              <>
                {/* Guided-only: show steps directly */}
                {isGuided && preview.guidedSteps && (
                  <div className="space-y-3">
                    {/* Description + risk row */}
                    <div className="flex items-start justify-between gap-3">
                      {preview.description && (
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {preview.description}
                        </p>
                      )}
                      <Badge
                        variant="outline"
                        className={`shrink-0 ${RISK_STYLES[preview.risk] ?? RISK_STYLES.medium}`}
                      >
                        {preview.risk}
                      </Badge>
                    </div>

                    {/* Steps card */}
                    <div className="rounded-lg border bg-muted/30 overflow-hidden">
                      <div className="flex items-center gap-2.5 border-b bg-primary/5 px-4 py-3">
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                          <ListOrdered className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <span className="text-sm font-medium">
                          {t('cloudTests_followStepsIn', {
                            provider: providerSlug ?? 'aws',
                          })}
                        </span>
                      </div>
                      <div className="px-4 py-3">
                        <ol className="space-y-4">
                          {preview.guidedSteps.map((step, i) => (
                            <li key={i} className="flex gap-3 text-[13px]">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary mt-0.5">
                                {i + 1}
                              </span>
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <StepContent text={step} />
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-[11px] text-muted-foreground/60">
                        {t('cloudTests_stepsToComplete', { count: preview.guidedSteps.length })}
                      </p>
                      <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                        {t('cloudTests_cancel')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Auto-fix: show preview + execute */}
                {!isGuided && (
                  <>
                    <p className="text-xs text-muted-foreground leading-relaxed break-words">
                      {preview.description}
                    </p>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          {t('cloudTests_riskLabel')}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${RISK_STYLES[preview.risk] ?? RISK_STYLES.medium}`}
                        >
                          {preview.risk}
                        </Badge>
                      </div>
                      {preview.rollbackSupported !== false && (
                        <div className="flex items-center gap-1 text-[10px] text-emerald-600">
                          <RotateCcw className="h-3 w-3" />
                          {t('cloudTests_rollbackAvailable')}
                        </div>
                      )}
                      {preview.rollbackSupported === false && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <AlertTriangle className="h-3 w-3" />
                          {t('cloudTests_irreversible')}
                        </div>
                      )}
                    </div>

                    {/* Current vs Proposed */}
                    <div className="grid grid-cols-2 gap-2 min-w-0">
                      <StateBlock
                        label={t('cloudTests_currentState')}
                        state={preview.currentState}
                      />
                      <StateBlock
                        label={t('cloudTests_proposedState')}
                        state={preview.proposedState}
                      />
                    </div>

                    {/* API calls — collapsible if many */}
                    {(preview.apiCalls?.length ?? 0) > 0 && (
                      <details className="text-xs" open>
                        <summary className="cursor-pointer text-muted-foreground font-medium">
                          {t('cloudTests_apiCallsCount', { count: preview.apiCalls?.length ?? 0 })}
                        </summary>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(preview.apiCalls ?? []).map((call, i) => {
                            const label =
                              typeof call === 'string'
                                ? call
                                : `${(call as { method?: string }).method} ${(call as { endpoint?: string }).endpoint}`;
                            return (
                              <code key={i} className="rounded bg-muted px-1 py-0.5 text-[10px]">
                                {label}
                              </code>
                            );
                          })}
                        </div>
                      </details>
                    )}

                    {/* Missing permissions — show setup step BEFORE apply */}
                    {preview.missingPermissions && preview.missingPermissions.length > 0 ? (
                      <div className="rounded-lg border overflow-hidden">
                        <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                          <p className="text-xs font-medium">
                            {t('cloudTests_permissionsNeeded', {
                              count: preview.missingPermissions.length,
                            })}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {t('cloudTests_runInCloudShellHint')}
                          </p>
                        </div>
                        <div className="p-3 space-y-2">
                          {preview.permissionFixScript && (
                            <pre className="rounded-md border bg-muted/20 px-3 py-2 text-[10px] font-mono leading-relaxed whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
                              {preview.permissionFixScript}
                            </pre>
                          )}
                          {preview.blockedPermissions && preview.blockedPermissions.length > 0 && (
                            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              {preview.blockedPermissionsMessage ??
                                'Some permissions need manual review and were not granted.'}{' '}
                              {formatBlockedActionsForDisplay(preview.blockedPermissions)}
                            </p>
                          )}
                          {preview.needsFreshPreview && !preview.permissionFixScript && (
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                              {preview.needsFreshPreview}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (preview.permissionFixScript) {
                                  navigator.clipboard
                                    .writeText(
                                      preview.permissionFixScript.replace(/\s*\\\n\s*/g, ' '),
                                    )
                                    .then(
                                      () => {
                                        toast.success(t('cloudTests_copiedShort'));
                                      },
                                      () => {
                                        toast.error('Copy failed — select and copy manually');
                                      },
                                    );
                                }
                              }}
                              className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                            >
                              {t('cloudTests_copy')}
                            </button>
                            <a
                              href="https://console.aws.amazon.com/cloudshell"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
                            >
                              CloudShell
                            </a>
                            <button
                              type="button"
                              onClick={() =>
                                loadPreview(
                                  // A recheck replays the expired client list
                                  // and returns the same script-less answer —
                                  // only a fresh preview breaks the loop.
                                  !(preview.needsFreshPreview && !preview.permissionFixScript),
                                )
                              }
                              disabled={isLoadingPreview}
                              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
                            >
                              {isLoadingPreview
                                ? t('cloudTests_checking')
                                : preview.needsFreshPreview && !preview.permissionFixScript
                                  ? t('cloudTests_freshPreview')
                                  : t('cloudTests_recheck')}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Permissions OK — show acknowledgment */
                      <label className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 cursor-pointer select-none dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        <input
                          type="checkbox"
                          checked={acknowledgment === 'acknowledged'}
                          onChange={(e) =>
                            setAcknowledgment(e.target.checked ? 'acknowledged' : null)
                          }
                          className="mt-0.5 shrink-0"
                        />
                        <span>{t('cloudTests_acknowledgeChanges')}</span>
                      </label>
                    )}

                    {hasNothingToApply && (
                      <p className="text-xs text-muted-foreground">
                        {t('cloudTests_noAutoFixBody')}
                      </p>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenChange(false)}
                        disabled={isExecuting}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleExecute}
                        disabled={
                          isExecuting ||
                          acknowledgment !== 'acknowledged' ||
                          (preview.missingPermissions?.length ?? 0) > 0 ||
                          hasNothingToApply
                        }
                      >
                        {isExecuting ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        {isExecuting ? t('cloudTests_applying') : t('cloudTests_applyFix')}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
