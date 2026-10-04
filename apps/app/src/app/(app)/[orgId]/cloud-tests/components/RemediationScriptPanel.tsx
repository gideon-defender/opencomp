'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';

/**
 * Setup-script actions for one remediation pair: copy the CloudShell
 * script or open CloudShell. Owns its copied state so parents never
 * re-render the button on unrelated changes.
 */
export function RemediationScriptPanel({
  script,
  cloudShellUrl,
}: {
  script: string;
  cloudShellUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
          1
        </span>
        <p className="text-xs text-muted-foreground pt-0.5">
          Copy the setup script and run it in AWS CloudShell
        </p>
      </div>
      <div className="flex items-start gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
          2
        </span>
        <p className="text-xs text-muted-foreground pt-0.5">
          Paste the <span className="font-medium text-foreground">Role ARN</span> from the output
          below
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          disabled={!script}
          className="flex flex-1 select-none items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" /> Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Copy Script
            </>
          )}
        </button>
        <a
          href={cloudShellUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 select-none items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open CloudShell
        </a>
      </div>
    </div>
  );
}
