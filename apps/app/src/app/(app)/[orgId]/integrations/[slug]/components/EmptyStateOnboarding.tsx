'use client';

import {
  CloudShellSetup,
  getSetupScriptDisabledMessage,
} from '@/components/integrations/CloudShellSetup';
import { CredentialInput } from '@/components/integrations/CredentialInput';
import { buildAwsPhase2Credentials, useAwsTwoStepConnect } from '@/hooks/use-aws-two-step-connect';
import type { IntegrationProvider } from '@/hooks/use-integration-platform';
import {
  useIntegrationConnections,
  useIntegrationMutations,
} from '@/hooks/use-integration-platform';
import { usePendingAwsConnection } from '@/hooks/use-pending-aws-connection';
import {
  getAwsCloudShellScript,
  getAwsCloudShellUrl,
  getAwsRemediationScript,
  normalizeAwsEnvironment,
} from '@gideon-defender/integration-platform';
import { Button, Label } from '@trycompai/design-system';
import { ArrowRight, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AwsScanModeStep,
  DEFAULT_AWS_SCAN_MODE_CHOICE,
  type AwsScanModeChoice,
} from './AwsScanModeStep';

// ─── Primitives ─────────────────────────────────────────────────────────

function StepHeader({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {step}
      </span>
      <h4 className="text-sm font-semibold">{title}</h4>
    </div>
  );
}

function FieldRow({
  field,
  value,
  error,
  onChange,
  optionsOverride,
  disabled,
}: {
  field: { id: string; label: string; required?: boolean; helpText?: string; type?: string };
  value: string | string[];
  error?: string;
  onChange: (value: string | string[]) => void;
  optionsOverride?: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.id}>
        {field.label}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <CredentialInput
        field={field as Parameters<typeof CredentialInput>[0]['field']}
        value={value}
        onChange={onChange}
        optionsOverride={optionsOverride}
        disabled={disabled}
      />
      {field.helpText && <p className="text-[11px] text-muted-foreground/70">{field.helpText}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Compact setup guide — shows only headings as collapsible sections, max 3-4 key steps each. */
function SetupGuide({
  text,
  fallback,
  docsUrl,
}: {
  text?: string | null;
  fallback: string;
  docsUrl?: string | null;
}) {
  const t = useTranslations('integrations');
  const raw = text || fallback;
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  // Parse into sections (split on ### headings)
  const sections = useMemo(() => {
    const lines = raw.split('\n');
    const result: Array<{ title: string; steps: string[] }> = [];
    let current: { title: string; steps: string[] } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('##')) {
        if (current) result.push(current);
        current = { title: trimmed.replace(/^#{1,4}\s*/, ''), steps: [] };
      } else if (current && (/^\d+[\.\)]\s/.test(trimmed) || trimmed.startsWith('- '))) {
        current.steps.push(trimmed.replace(/^\d+[\.\)]\s*/, '').replace(/^-\s*/, ''));
      } else if (current && trimmed.startsWith('>')) {
        current.steps.push(trimmed.replace(/^>\s*/, ''));
      } else if (current) {
        current.steps.push(trimmed);
      }
    }
    if (current) result.push(current);
    return result;
  }, [raw]);

  // No structured content — simple fallback
  if (sections.length === 0) {
    return <p className="text-xs text-muted-foreground leading-relaxed">{formatInline(raw)}</p>;
  }

  return (
    <div className="space-y-1">
      {sections.map((section, i) => {
        const isOpen = expandedSection === i;
        const previewSteps = section.steps.slice(0, 3);

        return (
          <div key={i}>
            <button
              type="button"
              onClick={() => setExpandedSection(isOpen ? null : i)}
              className="flex items-center gap-2 w-full text-left py-2 group"
            >
              <svg
                className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-xs font-medium group-hover:text-foreground transition-colors">
                {section.title}
              </span>
              <span className="text-[9px] text-muted-foreground/50 ml-auto">
                {t('onboarding.stepCount', { count: section.steps.length })}
              </span>
            </button>
            {isOpen && (
              <div className="ml-5 pb-2 space-y-1.5">
                {previewSteps.map((step, j) => (
                  <div key={j} className="flex items-start gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-[8px] font-semibold text-muted-foreground mt-0.5">
                      {j + 1}
                    </span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {formatInline(step)}
                    </p>
                  </div>
                ))}
                {section.steps.length > 3 && (
                  <p className="text-[10px] text-muted-foreground/50 pl-6">
                    {t('onboarding.moreStepsInDocs', { count: section.steps.length - 3 })}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      {docsUrl && (
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors pt-1"
        >
          {t('onboarding.viewFullDocs')}
          <ArrowRight className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/** Format inline markdown: **bold**, `code`, [links](url) */
function formatInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <span key={i} className="font-medium text-foreground">
          {part.slice(2, -2)}
        </span>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-foreground/80"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Main ───────────────────────────────────────────────────────────────

interface EmptyStateOnboardingProps {
  provider: IntegrationProvider;
  orgId: string;
  onConnected: () => void;
  /** For OAuth providers — opens the OAuth flow */
  onOAuthConnect?: () => void;
}

export function EmptyStateOnboarding({
  provider,
  orgId,
  onConnected,
  onOAuthConnect,
}: EmptyStateOnboardingProps) {
  const isOAuth = provider.authType === 'oauth2';
  const isCloudProvider = provider.category === 'Cloud';
  const isComingSoon = isOAuth && provider.oauthConfigured === false;

  // Coming soon — show info + notify
  if (isComingSoon) {
    return <ComingSoonState provider={provider} />;
  }

  // OAuth providers get a simple connect card
  if (isOAuth) {
    return <OAuthSetup provider={provider} onConnect={onOAuthConnect} />;
  }

  // Cloud providers with setup scripts get the full guided flow
  if (isCloudProvider && provider.setupScript) {
    return <CloudSetup provider={provider} orgId={orgId} onConnected={onConnected} />;
  }

  // Everything else: API key / basic / custom credentials
  return <CredentialSetup provider={provider} orgId={orgId} onConnected={onConnected} />;
}

// ─── OAuth (GitHub, Google Workspace, etc.) ─────────────────────────────

function ComingSoonState({ provider }: { provider: IntegrationProvider }) {
  const t = useTranslations('integrations');
  return (
    <div className="py-6">
      <div className="rounded-xl border bg-background shadow-sm max-w-2xl">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            {provider.logoUrl && (
              <Image
                src={provider.logoUrl}
                alt=""
                width={36}
                height={36}
                className="h-9 w-9 rounded-lg"
              />
            )}
            <div>
              <h3 className="text-sm font-semibold">{provider.name}</h3>
              <p className="text-xs text-muted-foreground">{provider.description}</p>
            </div>
          </div>
          <div className="rounded-lg bg-muted/40 border border-dashed px-4 py-5 text-center space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              {t('onboarding.comingSoon')}
            </p>
            <p className="text-xs text-muted-foreground/70 max-w-sm mx-auto">
              {t('onboarding.comingSoonDescription')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OAuthSetup({
  provider,
  onConnect,
}: {
  provider: IntegrationProvider;
  onConnect?: () => void;
}) {
  const t = useTranslations('integrations');
  return (
    <div className="py-6">
      <div className="flex items-center justify-between rounded-xl border bg-background shadow-sm px-6 py-5">
        <div className="flex items-center gap-4">
          {provider.logoUrl && (
            <Image
              src={provider.logoUrl}
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-lg"
            />
          )}
          <div>
            <h3 className="text-sm font-semibold">
              {t('onboarding.connectProvider', { name: provider.name })}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('onboarding.redirectOAuth')}</p>
          </div>
        </div>
        <Button onClick={onConnect}>
          {t('onboarding.connect')}
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── API Key / Basic / Custom Credentials ──────────────────────────────

function CredentialSetup({
  provider,
  onConnected,
}: {
  provider: IntegrationProvider;
  orgId: string;
  onConnected: () => void;
}) {
  const t = useTranslations('integrations');
  const { createConnection } = useIntegrationMutations();
  const [connecting, setConnecting] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, string | string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fields = useMemo(() => {
    const configuredFields = provider.credentialFields ?? [];

    if (provider.authType === 'basic' && configuredFields.length === 0) {
      return [
        {
          id: 'username',
          label: t('onboarding.username'),
          type: 'text' as const,
          required: true,
          placeholder: t('onboarding.enterUsername'),
        },
        {
          id: 'password',
          label: t('onboarding.password'),
          type: 'password' as const,
          required: true,
          placeholder: t('onboarding.enterPassword'),
        },
      ];
    }

    if (provider.authType === 'api_key' && configuredFields.length === 0) {
      return [
        {
          id: 'api_key',
          label: t('onboarding.apiKey'),
          type: 'password' as const,
          required: true,
          placeholder: t('onboarding.enterApiKey'),
        },
      ];
    }

    return configuredFields;
  }, [provider.authType, provider.credentialFields, t]);
  const hasConfigurableFields = fields.length > 0;

  const updateCredential = (fieldId: string, value: string | string[]) => {
    setCredentials((prev) => ({ ...prev, [fieldId]: value }));
    if (errors[fieldId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  };

  const handleConnect = useCallback(async () => {
    const newErrors: Record<string, string> = {};
    for (const field of fields) {
      const value = credentials[field.id];
      const isMissing =
        field.type === 'multi-select'
          ? !Array.isArray(value) || value.length === 0
          : !String(value ?? '').trim();
      if (field.required && isMissing) {
        newErrors[field.id] = t('onboarding.fieldRequired', { label: field.label });
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setConnecting(true);
    try {
      const result = await createConnection(provider.id, credentials);
      if (!result.success) {
        toast.error(result.error || t('onboarding.connectFailed'));
        return;
      }
      toast.success(t('onboarding.connected', { name: provider.name }));
      onConnected();
    } catch {
      toast.error(t('onboarding.connectFailed'));
    } finally {
      setConnecting(false);
    }
  }, [fields, credentials, createConnection, provider, onConnected, t]);

  return (
    <div className="py-6 space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight">
          {t('onboarding.connectProvider', { name: provider.name })}
        </h3>
        <p className="text-sm text-muted-foreground">
          {provider.description || t('onboarding.enterCredentials')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* Main form */}
        <div className="rounded-xl border bg-background shadow-sm">
          <div className="p-6 space-y-4">
            {hasConfigurableFields ? (
              fields.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  value={credentials[field.id] || (field.type === 'multi-select' ? [] : '')}
                  error={errors[field.id]}
                  onChange={(v) => updateCredential(field.id, v)}
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                No additional setup fields are required for this integration.
                {provider.docsUrl ? (
                  <>
                    {' '}
                    <a
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      Open docs
                    </a>
                    .
                  </>
                ) : null}
              </div>
            )}
          </div>
          <div className="border-t bg-muted/30 px-6 py-5 rounded-b-xl">
            <Button onClick={handleConnect} disabled={connecting} loading={connecting}>
              {connecting ? (
                'Connecting...'
              ) : (
                <>
                  Connect account
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Sidebar — setup guide */}
        <div className="rounded-xl border bg-background shadow-sm lg:sticky lg:top-20 overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 pt-5 pb-3">
            {provider.logoUrl && (
              <Image
                src={provider.logoUrl}
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 rounded-lg"
              />
            )}
            <h4 className="text-sm font-semibold">Setup guide</h4>
          </div>
          <div className="px-5 pb-5">
            <SetupGuide
              text={provider.setupInstructions}
              fallback={`You'll need your ${provider.name} credentials. Check your ${provider.name} admin console for the required values.`}
              docsUrl={provider.docsUrl}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Cloud Providers (AWS, GCP, Azure) ─────────────────────────────────

function CloudSetup({
  provider,
  orgId,
  onConnected,
}: {
  provider: IntegrationProvider;
  orgId: string;
  onConnected: () => void;
}) {
  const { createConnection } = useIntegrationMutations();
  const [connecting, setConnecting] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, string | string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // AWS only — which scan engine the customer is choosing for this
  // connection. Sent in createConnection's credentials payload as the
  // `awsScanMode` variable, then read on every scan in cloud-security.service.
  const [awsScanMode, setAwsScanMode] = useState<AwsScanModeChoice>(DEFAULT_AWS_SCAN_MODE_CHOICE);
  // Phase 1 of the AWS two-step: the pending connection minted by the
  // server to issue this connection's External ID. The hook keeps the
  // show-once value in session storage (and falls back to the newest
  // pending row from the list below), so a refresh never orphans the
  // connection or mints a duplicate. The global connections cache is NOT
  // invalidated here, so the parent keeps showing onboarding until phase 2
  // validates.
  const { connections } = useIntegrationConnections();
  const { pendingConnection, setPendingConnection, clearPendingConnection } =
    usePendingAwsConnection({ orgId, providerId: provider.id, connections });
  const { startPendingConnection, completePendingConnection } = useAwsTwoStepConnect({
    providerId: provider.id,
    orgId,
  });
  const isAwsProvider = provider.id === 'aws';
  // Setup scripts must carry the server-issued value — never the org ID.
  // Before phase 1 the placeholder renders literally (copy is disabled).
  const setupExternalId = pendingConnection?.externalId ?? 'YOUR_EXTERNAL_ID';

  const allFields = useMemo(() => provider.credentialFields ?? [], [provider.credentialFields]);
  const visibleFields = allFields.filter(
    (field) => field.id !== 'externalId' && field.id !== 'connectionName',
  );

  const updateCredential = (fieldId: string, value: string | string[]) => {
    setCredentials((prev) => ({
      ...prev,
      [fieldId]: value,
      ...(fieldId === 'awsType' ? { regions: [] } : {}),
    }));
    if (errors[fieldId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  };

  const handleConnect = useCallback(async () => {
    // AWS connects in two steps: the External ID is minted server-side, so
    // the IAM role can only be created AFTER phase 1 returns it. Non-AWS
    // providers keep the one-shot flow.
    if (isAwsProvider && !pendingConnection) {
      if (typeof credentials.awsType !== 'string' || !credentials.awsType) {
        setErrors({ awsType: 'Select an AWS environment first' });
        return;
      }
      setConnecting(true);
      try {
        const result = await startPendingConnection({
          fields: {
            ...(typeof credentials.awsType === 'string' ? { awsType: credentials.awsType } : {}),
            ...(Array.isArray(credentials.regions) ? { regions: credentials.regions } : {}),
            awsScanMode,
          },
        });
        if (!result.success || !result.id || !result.externalId) {
          toast.error(result.error || 'Failed to start connection');
          return;
        }
        setPendingConnection({
          id: result.id,
          externalId: result.externalId,
        });
        toast.success('External ID issued — run the setup script, then paste your Role ARN.');
      } catch {
        toast.error('Failed to start connection');
      } finally {
        setConnecting(false);
      }
      return;
    }

    const finalCredentials = buildAwsPhase2Credentials(credentials);
    // AWS only — persist the customer's scan engine choice on the
    // connection. The scan service reads this from metadata on every
    // run. resolveAwsScanMode() handles the missing-field case for
    // every other provider and for pre-feature historical connections.
    if (provider.id === 'aws') {
      finalCredentials.awsScanMode = awsScanMode;
    }

    const newErrors: Record<string, string> = {};
    for (const field of allFields) {
      if (field.id === 'externalId' || field.id === 'connectionName') continue;
      const value = finalCredentials[field.id];
      const isMissing =
        field.type === 'multi-select'
          ? !Array.isArray(value) || value.length === 0
          : !String(value ?? '').trim();
      if (field.required && isMissing) {
        newErrors[field.id] = `${field.label} is required`;
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setConnecting(true);
    try {
      // Phase 2 of the AWS flow completes the pending connection (validates
      // the Role ARN against the minted External ID and activates).
      // Every other case is the legacy one-shot create.
      const result =
        isAwsProvider && pendingConnection
          ? await completePendingConnection({
              pendingId: pendingConnection.id,
              credentials: finalCredentials,
            })
          : await createConnection(provider.id, finalCredentials);
      if (!result.success) {
        if (isAwsProvider && 'notFound' in result && result.notFound) {
          // The stored pending row is gone — drop it so the next click
          // returns to phase 1 instead of retrying a dead ID forever.
          clearPendingConnection();
          toast.error('That pending connection no longer exists — generate a new External ID.');
        } else {
          toast.error(result.error || 'Failed to connect');
        }
        return;
      }
      toast.success(`${provider.name} connected and verified!`);
      setCredentials({});
      clearPendingConnection();
      onConnected();
    } catch {
      toast.error('Failed to connect');
    } finally {
      setConnecting(false);
    }
  }, [
    allFields,
    awsScanMode,
    credentials,
    createConnection,
    completePendingConnection,
    startPendingConnection,
    setPendingConnection,
    clearPendingConnection,
    provider,
    onConnected,
    isAwsProvider,
    pendingConnection,
  ]);

  const connectionFields = visibleFields.filter(
    (f) => f.id !== 'remediationRoleArn' && f.id !== 'regions' && f.id !== 'awsType',
  );
  const regionFields = visibleFields.filter((f) => f.id === 'regions');
  const remediationFields = visibleFields.filter((f) => f.id === 'remediationRoleArn');
  const awsTypeFields = visibleFields.filter((f) => f.id === 'awsType');
  const hasSelectedAwsEnvironment =
    provider.id !== 'aws' || typeof credentials.awsType === 'string';
  const setupScriptDisabledMessage = getSetupScriptDisabledMessage({
    isAws: isAwsProvider,
    hasSelectedEnvironment: hasSelectedAwsEnvironment,
  });
  const awsEnvironment = normalizeAwsEnvironment(credentials.awsType);
  const regionOptions = regionFields[0]?.options ?? [];
  const filteredRegionOptions =
    provider.id === 'aws'
      ? regionOptions.filter((option) =>
          awsEnvironment === 'aws-us-gov'
            ? option.value.startsWith('us-gov-')
            : !option.value.startsWith('us-gov-'),
        )
      : regionOptions;
  const setupScript =
    provider.id === 'aws' ? getAwsCloudShellScript(awsEnvironment) : (provider.setupScript ?? '');
  const remediationScript = getAwsRemediationScript(awsEnvironment);
  const cloudShellUrl = getAwsCloudShellUrl(awsEnvironment);

  const hasRemediation = provider.id === 'aws' && remediationFields.length > 0;

  return (
    <div className="py-6 space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight">Get started</h3>
        <p className="text-sm text-muted-foreground">
          Connect a read-only IAM role to start scanning your cloud security posture.
        </p>
      </div>

      <div
        className={`grid grid-cols-1 ${hasRemediation ? 'lg:grid-cols-[1fr_320px]' : ''} gap-6 items-start`}
      >
        {/* ─── Left: Unified setup flow ─── */}
        <div className="rounded-xl border bg-background shadow-sm">
          {/* Step 1 — AWS only — Scan engine choice. Mutually exclusive
              between OpenComp scanners (default) and AWS Security Hub.
              Customers can switch later from CloudSettingsModal. */}
          {provider.id === 'aws' && (
            <div className="p-6 space-y-4">
              <StepHeader step={1} title="Scan Engine" />
              <AwsScanModeStep
                value={awsScanMode}
                onChange={setAwsScanMode}
                disabled={connecting}
              />
            </div>
          )}

          {/* Step 2 — AWS only — Commercial vs GovCloud */}
          {awsTypeFields.length > 0 && (
            <>
              {provider.id === 'aws' && <div className="border-t" />}
              <div className="p-6 space-y-4">
                <StepHeader step={2} title="AWS Environment" />
                {awsTypeFields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    value={credentials[field.id] || ''}
                    error={errors[field.id]}
                    onChange={(v) => updateCredential(field.id, v)}
                  />
                ))}
              </div>
            </>
          )}
          {/* Step 3 — AWS only — IAM role creation script */}
          {provider.setupScript && (
            <div className="p-6 space-y-4">
              <StepHeader step={3} title="Create IAM Role" />
              <CloudShellSetup
                script={setupScript}
                externalId={setupExternalId}
                cloudShellUrl={cloudShellUrl}
                disabled={!hasSelectedAwsEnvironment || (isAwsProvider && !pendingConnection)}
                disabledMessage={setupScriptDisabledMessage}
              />
              <p className="text-[11px] text-muted-foreground/60">
                Connecting multiple accounts? Run the script in each account and add them one by
                one.
              </p>
            </div>
          )}

          <div className="border-t" />

          {/* Step 4 — Connection details (Role ARN etc.) */}
          <div className="p-6 space-y-4">
            <StepHeader step={4} title="Connection Details" />
            {connectionFields.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                value={credentials[field.id] || (field.type === 'multi-select' ? [] : '')}
                error={errors[field.id]}
                onChange={(v) => updateCredential(field.id, v)}
              />
            ))}
          </div>

          {/* Step 5 — Scan configuration (regions) */}
          {regionFields.length > 0 && (
            <>
              <div className="border-t" />
              <div className="p-6 space-y-4">
                <StepHeader step={5} title="Scan Configuration" />
                {regionFields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    value={credentials[field.id] || []}
                    error={errors[field.id]}
                    onChange={(v) => updateCredential(field.id, v)}
                    optionsOverride={filteredRegionOptions}
                    disabled={!hasSelectedAwsEnvironment}
                  />
                ))}
              </div>
            </>
          )}

          {/* CTA */}
          <div className="border-t bg-muted/30 px-6 py-5 rounded-b-xl">
            <div className="flex items-center gap-2">
              <Button onClick={handleConnect} disabled={connecting} loading={connecting}>
                {connecting ? (
                  'Connecting...'
                ) : isAwsProvider && !pendingConnection ? (
                  <>
                    Generate External ID
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    Connect Account
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </>
                )}
              </Button>
              {isAwsProvider && pendingConnection && (
                <Button
                  variant="ghost"
                  onClick={clearPendingConnection}
                  disabled={connecting}
                  title="Discard this pending connection and generate a new External ID"
                >
                  Start over
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ─── Right: Optional sidebar ─── */}
        {hasRemediation && (
          <div className="lg:sticky lg:top-20 space-y-1.5">
            <div className="rounded-xl border bg-background shadow-sm">
              <div className="flex items-center gap-2.5 px-5 pt-5 pb-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <h4 className="text-sm font-semibold flex-1">Auto-Remediation</h4>
                <span className="text-[10px] text-muted-foreground border rounded-full px-2 py-0.5">
                  Optional
                </span>
              </div>
              <div className="px-5 pb-5 space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Enable one-click fixes for security findings. This creates a separate write-access
                  role — your audit role stays read-only.
                </p>
                <CloudShellSetup
                  script={remediationScript}
                  externalId={setupExternalId}
                  cloudShellUrl={cloudShellUrl}
                  disabled={!hasSelectedAwsEnvironment || (isAwsProvider && !pendingConnection)}
                  disabledMessage={setupScriptDisabledMessage}
                  title="Remediation Role"
                  subtitle="Write-access role for auto-fix"
                  footnote=""
                />
                {remediationFields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    value={credentials[field.id] || ''}
                    error={errors[field.id]}
                    onChange={(v) => updateCredential(field.id, v)}
                  />
                ))}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/50 px-1">
              You can always enable this later from Settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
