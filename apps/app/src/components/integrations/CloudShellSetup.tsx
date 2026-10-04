'use client';

import { escapeDoubleQuotedShell } from '@gideon-defender/integration-platform';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

export function getSetupScriptDisabledMessage({
  isAws,
  hasSelectedEnvironment,
}: {
  isAws: boolean;
  hasSelectedEnvironment: boolean;
}): string | undefined {
  // The script box is disabled in two states with different unblock steps:
  // no environment yet (pick one above) vs environment picked but no pending
  // connection (click Generate External ID below). One static message lies
  // about the second state, so pick per state.
  if (!isAws || !hasSelectedEnvironment) {
    return undefined;
  }
  return 'Generate your External ID below first — the script needs your issued value.';
}

export function CloudShellSetup({
  script,
  externalId,
  title,
  subtitle,
  footnote,
  cloudShellUrl = 'https://console.aws.amazon.com/cloudshell',
  disabled = false,
  disabledMessage = 'Select an AWS environment before copying the setup script.',
}: {
  script: string;
  externalId: string;
  title?: string;
  subtitle?: string;
  footnote?: string;
  cloudShellUrl?: string;
  disabled?: boolean;
  disabledMessage?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Collapse when the script becomes unavailable so re-enabling returns to
  // the preview instead of a stale full-script view. Adjusted during render
  // (same pattern as the dialog's open-state init) — no effect needed.
  const [wasDisabled, setWasDisabled] = useState(disabled);
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled);
    if (disabled) {
      setExpanded(false);
    }
  }

  // The External ID is stored caller-controlled text interpolated into an
  // `EXTERNAL_ID="..."` assignment — escape it so a value saved before
  // server-side validation cannot break out and inject shell commands.
  const finalScript = script.replace(/YOUR_EXTERNAL_ID/g, escapeDoubleQuotedShell(externalId));

  const handleCopy = useCallback(() => {
    if (disabled) {
      toast.error(disabledMessage);
      return;
    }

    navigator.clipboard.writeText(finalScript);
    setCopied(true);
    toast.success('Script copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }, [disabled, disabledMessage, finalScript]);

  // Show first 3 meaningful lines as preview
  const previewLines = finalScript
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('set '))
    .slice(0, 3)
    .join('\n');

  return (
    <div className="space-y-3">
      {(title || subtitle) && (
        <div>
          {title && <p className="text-sm font-medium">{title}</p>}
          {subtitle && (
            <p className="font-mono text-xs text-muted-foreground break-all">{subtitle}</p>
          )}
        </div>
      )}
      {/* Instructions */}
      <ol className="space-y-1.5 text-sm text-muted-foreground list-none">
        <li className="flex items-start gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground mt-0.5">
            1
          </span>
          <span>
            Copy the setup script and run it in{' '}
            <span className="font-medium text-foreground">AWS CloudShell</span>
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-muted-foreground mt-0.5">
            2
          </span>
          <span>
            Paste the <span className="font-medium text-foreground">Role ARN</span> from the output
            into the form
          </span>
        </li>
      </ol>

      {/* Script preview block */}
      <div className="rounded-lg border bg-muted/40 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-[10px] text-muted-foreground font-mono">setup.sh</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a
              href={cloudShellUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              CloudShell
            </a>
          </div>
        </div>
        <div className="px-3 py-2.5">
          <pre className="text-[11px] font-mono leading-relaxed text-foreground/70 whitespace-pre-wrap break-all">
            {disabled ? disabledMessage : expanded ? finalScript : previewLines}
          </pre>
          {/* No expand toggle while disabled: the preview shows the
              disabled message in both states, so the toggle would visibly do
              nothing. It returns once the script is available. */}
          {!disabled && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Show full script...
            </button>
          )}
          {!disabled && expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Collapse
            </button>
          )}
        </div>
      </div>

      {footnote && <p className="text-[10px] text-muted-foreground/60">{footnote}</p>}
    </div>
  );
}

export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="relative py-2">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-background px-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {label}
        </span>
      </div>
    </div>
  );
}
