'use client';

import type { PentestIssue } from '@/lib/security/penetration-tests-client';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@trycompai/design-system';
import { cn } from '@trycompai/design-system/cn';
import { ArrowLeft, Copy } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FindingContextSection } from './FindingContextSection';
import { SEVERITY_BAR_VAR, SEVERITY_FG_VAR } from './severity';

interface FindingDetailProps {
  orgId: string;
  issue: PentestIssue;
  runId?: string | null;
  targetUrl?: string | null;
  onBack: () => void;
}

const TABS = [
  { value: 'summary' },
  { value: 'poc' },
  { value: 'impact' },
  { value: 'remediation' },
  { value: 'validation' },
  { value: 'attack' },
  { value: 'evidence' },
] as const;

export function FindingDetail({ orgId, issue, runId, targetUrl, onBack }: FindingDetailProps) {
  const t = useTranslations('security');
  const accentBar = SEVERITY_BAR_VAR[issue.severity];
  const eyebrowFg = SEVERITY_FG_VAR[issue.severity];

  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-8 md:py-8">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('penTest.findingDetail.backToFindings')}
          </Button>
        </div>

        {/* Hero — neutral card surface so the severity wash doesn't
            dominate the page; severity is still instantly readable via
            the colored left accent bar and the eyebrow label. */}
        <header
          className="rounded-[var(--radius)] border border-border border-l-4 bg-card p-6"
          style={{ borderLeftColor: accentBar }}
        >
          <div
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: eyebrowFg }}
          >
            {issue.severity}
            {issue.cweId ? ` · ${issue.cweId}` : ''}
            {typeof issue.cvssScore === 'number' ? ` · CVSS ${issue.cvssScore}` : ''}
          </div>
          <h1 className="mt-2 text-[24px] font-medium leading-tight tracking-[-0.02em]">
            {issue.title}
          </h1>
          {issue.summary ? (
            <p className="mt-3 text-sm text-muted-foreground">{issue.summary}</p>
          ) : null}
        </header>

        {/* KV strip */}
        <KVStrip issue={issue} t={t} />

        {/* Customer context shared with the agent on future scans */}
        <FindingContextSection orgId={orgId} issue={issue} runId={runId} targetUrl={targetUrl} />

        {/* Tabs */}
        <Tabs defaultValue="summary">
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tabLabel(t, tab.value)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="summary">
            <div className="mt-4">
              <Prose
                text={issue.description ?? issue.summary ?? t('penTest.findingDetail.noSummary')}
              />
            </div>
          </TabsContent>

          <TabsContent value="poc">
            <div className="mt-4">
              {/* Use truthiness (`||`) rather than `??` so empty-string
                  values from upstream still render the fallback message. */}
              <CopyableBlock
                content={issue.proofOfConcept || t('penTest.findingDetail.noPoc')}
                empty={!issue.proofOfConcept}
                t={t}
              />
            </div>
          </TabsContent>

          <TabsContent value="impact">
            <div className="mt-4">
              <Prose text={issue.impact ?? t('penTest.findingDetail.noImpact')} />
            </div>
          </TabsContent>

          <TabsContent value="remediation">
            <div className="mt-4">
              <Prose text={issue.remediation ?? t('penTest.findingDetail.noRemediation')} />
            </div>
          </TabsContent>

          <TabsContent value="validation">
            <div className="mt-4">
              <ValidationSection t={t} />
            </div>
          </TabsContent>

          <TabsContent value="attack">
            <p className="mt-4 text-sm text-muted-foreground">
              {t('penTest.findingDetail.attackPathNote')}
            </p>
          </TabsContent>

          <TabsContent value="evidence">
            <p className="mt-4 text-sm text-muted-foreground">
              {t('penTest.findingDetail.evidenceNote')}
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function KVStrip({
  issue,
  t,
}: {
  issue: PentestIssue;
  t: ReturnType<typeof useTranslations<'security'>>;
}) {
  const cells = [
    { label: t('penTest.findingDetail.status'), value: issue.status },
    {
      label: t('penTest.findingDetail.affected'),
      value: issue.affectedEndpoint ?? '—',
    },
    {
      label: t('penTest.findingDetail.cvss'),
      value: typeof issue.cvssScore === 'number' ? issue.cvssScore.toFixed(1) : '—',
    },
    { label: t('penTest.findingDetail.cwe'), value: issue.cweId ?? '—' },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[var(--radius)] border border-border md:grid-cols-4">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={cn(
            'flex flex-col gap-1 border-border px-4 py-3',
            i < cells.length - 1 && 'md:border-r',
            i < 2 && 'border-b md:border-b-0',
          )}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {cell.label}
          </span>
          <span className="truncate font-mono text-xs">{cell.value}</span>
        </div>
      ))}
    </div>
  );
}

function Prose({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>;
}

function CopyableBlock({
  content,
  empty,
  t,
}: {
  content: string;
  empty: boolean;
  t: ReturnType<typeof useTranslations<'security'>>;
}) {
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(t('penTest.finding.copiedToClipboard'));
    } catch {
      toast.error(t('penTest.finding.unableToCopy'));
    }
  };
  if (empty) {
    return <p className="text-sm text-muted-foreground">{content}</p>;
  }
  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10">
        <Button variant="outline" size="sm" onClick={() => void onCopy()}>
          <Copy className="h-3.5 w-3.5" />
          {t('penTest.findingDetail.copy')}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-[var(--radius)] border border-border bg-muted/50 p-4 pr-20 font-mono text-xs leading-relaxed">
        {content}
      </pre>
    </div>
  );
}

function ValidationSection({ t }: { t: ReturnType<typeof useTranslations<'security'>> }) {
  const steps = extractValidationSteps();
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('penTest.findingDetail.noValidationSteps')}
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li
          key={i}
          className="flex items-start gap-3 rounded-[var(--radius)] border border-border bg-background p-3 text-sm"
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted font-mono text-[10px]">
            {i + 1}
          </span>
          <span className="flex-1">{step}</span>
        </li>
      ))}
    </ol>
  );
}

// Validation-steps field isn't part of PentestIssue type (yet); parse if it
// shows up on future payloads. For now returns empty.
function extractValidationSteps(): string[] {
  return [];
}

function tabLabel(
  t: ReturnType<typeof useTranslations<'security'>>,
  value: (typeof TABS)[number]['value'],
): string {
  switch (value) {
    case 'summary':
      return t('penTest.findingDetail.tabSummary');
    case 'poc':
      return t('penTest.findingDetail.tabPoc');
    case 'impact':
      return t('penTest.findingDetail.tabImpact');
    case 'remediation':
      return t('penTest.findingDetail.tabRemediation');
    case 'validation':
      return t('penTest.findingDetail.tabValidation');
    case 'attack':
      return t('penTest.findingDetail.tabAttack');
    case 'evidence':
      return t('penTest.findingDetail.tabEvidence');
  }
}
