'use client';

import { Button } from '@gideon-defender/ui/button';
import { Check, Copy, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { isGuidanceOnlyScript } from '../lib/batch-merge-script';
import {
  formatBlockedActionsForDisplay,
  splitBlockedRemediationActions,
} from '../lib/remediation-denylist';
import {
  buildAwsFixScript,
  detectServiceLinkedRole,
  extractActionsFromError,
  isAzureError,
  isGcpError,
  isPermissionErrorMessage,
} from './permission-error-helpers';

interface PermissionErrorPanelProps {
  error: string;
  /** Missing IAM actions extracted from the error (preferred). */
  missingActions?: string[];
  /** Planned API calls from the preview (fallback for AWS). */
  apiCalls?: string[];
  /** Ready-to-paste fix script from backend (preferred over client-side). */
  fixScript?: string;
  /** Actions the backend flagged for manual review (never grantable). */
  blockedPermissions?: string[];
  /** Backend-authored explanation for the manual-review actions. */
  blockedPermissionsMessage?: string;
  /** Cloud provider — affects script format and links. */
  provider?: 'aws' | 'gcp' | 'azure';
  /** Retry the remediation after the user fixes permissions. */
  onRetry?: () => void;
  isRetrying?: boolean;
  isWaiting?: boolean;
}

export function PermissionErrorPanel({
  error,
  missingActions,
  apiCalls,
  fixScript: backendScript,
  blockedPermissions: backendBlockedPermissions,
  blockedPermissionsMessage: backendBlockedMessage,
  provider,
  onRetry,
  isRetrying,
  isWaiting,
}: PermissionErrorPanelProps) {
  const [copied, setCopied] = useState(false);

  // Auto-detect provider if not specified
  const detectedProvider =
    provider ?? (isAzureError(error) ? 'azure' : isGcpError(error) ? 'gcp' : 'aws');
  const isGcp = detectedProvider === 'gcp';
  const isAzure = detectedProvider === 'azure';

  // Service-linked-role commands are AWS-only — never render the AWS CLI
  // inside the Azure or GCP branches.
  const serviceLinkedRole = isGcp || isAzure ? null : detectServiceLinkedRole(error);
  const isPermissionError = serviceLinkedRole !== null || isPermissionErrorMessage(error);

  if (!isPermissionError) {
    // Truncate long AI-generated messages for clean UX
    const shortError =
      error.length > 150 ? error.slice(0, 150).replace(/\s+\S*$/, '') + '…' : error;
    const hasDetails = error.length > 150;

    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          Fix could not be applied
        </p>
        <p className="text-xs text-red-700/80 dark:text-red-400/80 mt-1">{shortError}</p>
        {hasDetails && (
          <details className="mt-2">
            <summary className="text-[11px] text-red-600 dark:text-red-400 cursor-pointer hover:underline">
              Show full details
            </summary>
            <p className="text-[11px] text-red-600/70 dark:text-red-400/70 mt-1 whitespace-pre-wrap">
              {error}
            </p>
          </details>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="mt-3 rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800 transition-colors disabled:opacity-50"
          >
            {isRetrying ? 'Retrying...' : 'Retry'}
          </button>
        )}
      </div>
    );
  }

  // Priority: service-linked role > backend script > client-parsed.
  // The service-linked-role command is an intentional manual-execution
  // exception: the admin runs it in their own CloudShell (AWS-defined
  // permissions, not a grant onto our role), so it is not an auto-grant of
  // the denylisted permission onto OpenComp-Remediator. The generic merge
  // path still filters that permission through the denylist.
  const parsedFromError = extractActionsFromError(error);
  const actions = missingActions?.length
    ? missingActions
    : parsedFromError.length
      ? parsedFromError
      : (apiCalls ?? []);

  const script = serviceLinkedRole
    ? serviceLinkedRole.command
    : (backendScript ?? (isGcp || isAzure ? null : buildAwsFixScript(actions)));

  // A guidance-only script names manual-review actions but runs nothing —
  // label it as guidance so nobody pastes it expecting a grant.
  const guidanceOnly = isGuidanceOnlyScript(script);
  // Client-built fallback scripts strip denylisted actions from the grant
  // (buildAwsFixScript splits internally). Split here too so the "Required"
  // banner matches what the script actually grants instead of listing
  // blocked actions as required. Backend-reported blocked actions are
  // excluded the same way: the banner must never present a manual-review
  // action as an ordinary requirement.
  const usingClientScript = !serviceLinkedRole && !backendScript && !isGcp && !isAzure;
  const clientSplit = usingClientScript ? splitBlockedRemediationActions(actions) : null;
  const manualReviewBlocked = [
    ...new Set([...(clientSplit?.blocked ?? []), ...(backendBlockedPermissions ?? [])]),
  ];
  const manualReviewSet = new Set(manualReviewBlocked.map((a) => a.toLowerCase()));
  // Case-insensitive on purpose: denylist matching is case-insensitive
  // (IAM evaluates actions that way), but the two action sources can use
  // different casings — otherwise a blocked action renders as "Required".
  const requiredActions = actions.filter((a) => !manualReviewSet.has(a.toLowerCase()));

  const shellName = isAzure ? 'Cloud Shell' : isGcp ? 'Cloud Shell' : 'CloudShell';
  const shellUrl = isAzure
    ? 'https://portal.azure.com/#cloudshell/'
    : isGcp
      ? 'https://console.cloud.google.com/cloudshell'
      : 'https://console.aws.amazon.com/cloudshell';
  const propagationText = isAzure
    ? 'Role assignment changes in Azure may take a few minutes to propagate.'
    : isGcp
      ? 'IAM changes in GCP may take a few minutes to propagate.'
      : 'IAM permission changes can take up to 10 seconds to propagate in AWS.';

  const handleCopy = () => {
    if (!script) return;
    navigator.clipboard.writeText(script).then(
      () => {
        setCopied(true);
        toast.success('Script copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        toast.error('Copy failed — select and copy manually');
      },
    );
  };

  // Retry lives outside the script block: when no script could be built
  // (zero parseable actions, GCP/Azure errors), retry is the only useful
  // action, so it must not hide behind the `{script && ...}` gate below.
  const retryButton = onRetry ? (
    <Button
      variant="outline"
      size="sm"
      onClick={onRetry}
      disabled={isRetrying || isWaiting}
      className="h-auto px-3 py-1.5 text-xs"
    >
      {isRetrying || isWaiting ? (
        <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw className="mr-1.5 h-3 w-3" />
      )}
      {isWaiting
        ? `Waiting for ${isAzure ? 'Azure' : isGcp ? 'GCP' : 'AWS'}...`
        : isRetrying
          ? 'Retrying...'
          : 'Retry'}
    </Button>
  ) : null;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {serviceLinkedRole
                ? 'Missing Service-Linked Role'
                : isGcp
                  ? 'Missing GCP IAM Permission'
                  : 'Missing IAM Permission'}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              {serviceLinkedRole ? (
                `${serviceLinkedRole.service} requires a service-linked role. Create it with the command below, then retry.`
              ) : isGcp ? (
                <>
                  Your GCP account is missing permissions needed for this fix.
                  {actions.length > 0 && (
                    <>
                      {' '}
                      Missing:{' '}
                      {actions.map((a, i) => (
                        <span key={a}>
                          {i > 0 && ', '}
                          <code className="font-mono">{a}</code>
                        </span>
                      ))}
                    </>
                  )}
                </>
              ) : (
                <>
                  The remediation role is missing permissions needed for this fix.
                  {requiredActions.length > 0 && (
                    <>
                      {' '}
                      Required:{' '}
                      {requiredActions.map((a, i) => (
                        <span key={a}>
                          {i > 0 && ', '}
                          <code className="font-mono">{a}</code>
                        </span>
                      ))}
                    </>
                  )}
                  {manualReviewBlocked.length > 0 && (
                    <>
                      {' '}
                      <span className="text-amber-700 dark:text-amber-400">
                        (
                        {backendBlockedMessage ??
                          `${manualReviewBlocked.length} need manual review and are excluded from the script`}
                        :{' '}
                        <code className="font-mono">
                          {formatBlockedActionsForDisplay(manualReviewBlocked)}
                        </code>
                        )
                      </span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {script && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2.5">
          <p className="text-xs font-medium">
            {guidanceOnly ? (
              'Manual review required — nothing to run:'
            ) : (
              <>
                Run this in {isAzure ? 'Azure' : isGcp ? 'Google' : 'AWS'} {shellName} to add the
                permission:
              </>
            )}
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-all">
            {script}
          </pre>
          {isGcp && (
            <p className="text-[10px] text-muted-foreground/80">
              Replace <code className="font-mono">YOUR_EMAIL</code> with your Google account email
              and <code className="font-mono">YOUR_PROJECT_ID</code> with your GCP project ID.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> {guidanceOnly ? 'Copy Details' : 'Copy Script'}
                </>
              )}
            </button>
            <a
              href={shellUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              <ExternalLink className="h-3 w-3" />
              Open {shellName}
            </a>
            {retryButton}
          </div>
          <p className="text-[10px] text-muted-foreground/60">{propagationText}</p>
        </div>
      )}
      {!script && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2.5">
          <p className="text-xs text-muted-foreground">
            No fix script could be built from this error. Add the missing permissions manually, then
            retry.
          </p>
          {retryButton && <div className="flex flex-wrap gap-2">{retryButton}</div>}
          <p className="text-[10px] text-muted-foreground/60">{propagationText}</p>
        </div>
      )}
    </div>
  );
}
