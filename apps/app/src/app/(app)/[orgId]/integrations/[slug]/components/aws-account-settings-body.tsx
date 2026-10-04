'use client';

import { CloudShellSetup } from '@/components/integrations/CloudShellSetup';
import { CredentialInput } from '@/components/integrations/CredentialInput';
import type { IntegrationProvider } from '@/hooks/use-integration-platform';
import {
  useIntegrationConnection,
  useIntegrationMutations,
} from '@/hooks/use-integration-platform';
import {
  getAwsCloudShellUrl,
  getAwsRemediationScript,
  normalizeAwsEnvironment,
  parseRemediationRolesMap,
} from '@gideon-defender/integration-platform';
import { Badge } from '@gideon-defender/ui/badge';
import { Button } from '@trycompai/design-system';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  AccountSettingsFieldGroup,
  AccountSettingsInfoRow,
  AccountSettingsSection,
} from './account-settings-shared-ui';
import { RemediationRolesTable } from './remediation-roles-table';

export function AwsAccountSettingsBody({
  open,
  connectionId,
  provider,
  onUpdated,
}: {
  open: boolean;
  connectionId: string;
  provider: IntegrationProvider;
  // orgId intentionally not destructured: the External ID shown here is the
  // server-minted value from metadata, never the organization ID.
  orgId: string;
  onUpdated?: () => void;
}) {
  const t = useTranslations('integrations');
  const { connection, isLoading } = useIntegrationConnection(open ? connectionId : null);
  const { updateConnectionCredentials, updateConnectionMetadata, deleteConnection } =
    useIntegrationMutations();

  const [roleArn, setRoleArn] = useState('');
  const [remediationRoleArn, setRemediationRoleArn] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [savingRemediation, setSavingRemediation] = useState(false);
  const [savingRemediationRoles, setSavingRemediationRoles] = useState(false);
  const [savingRegions, setSavingRegions] = useState(false);
  const [savingAwsType, setSavingAwsType] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [awsType, setAwsType] = useState('');

  const metadata = (connection?.metadata ?? {}) as Record<string, unknown>;
  const displayName =
    (metadata.connectionName as string) ?? (metadata.accountId as string) ?? connectionId;
  const accountId = metadata.accountId as string | undefined;
  // The External ID shown here is the server-minted value synced from the
  // vault (create-time + backfill). Never fall back to the org ID: a wrong
  // value in the setup script creates a role the server will reject.
  const externalId = (metadata.externalId as string) ?? '';
  // Pair map syncs from the server as a parsed record (see the credentials
  // update endpoint); the legacy single ARN stays as dual-read fallback.
  const remediationRolesMap = parseRemediationRolesMap(metadata.remediationRoles);
  const hasRemediation =
    Boolean(metadata.remediationRoleArn) || Object.keys(remediationRolesMap).length > 0;
  const showLegacyBanner =
    Boolean(metadata.remediationRoleArn) && Object.keys(remediationRolesMap).length === 0;
  const regionsField = provider.credentialFields?.find((f) => f.id === 'regions');
  const awsEnvironment = normalizeAwsEnvironment(awsType);
  const remediationScript = getAwsRemediationScript(awsEnvironment);
  const cloudShellUrl = getAwsCloudShellUrl(awsEnvironment);
  const filteredRegionOptions =
    regionsField?.options?.filter((option) =>
      awsEnvironment === 'aws-us-gov'
        ? option.value.startsWith('us-gov-')
        : !option.value.startsWith('us-gov-'),
    ) ?? [];

  const [prevAwsConnection, setPrevAwsConnection] = useState(connection);
  const [prevAwsRoleArn, setPrevAwsRoleArn] = useState(metadata.roleArn);
  const [prevAwsRemediationRoleArn, setPrevAwsRemediationRoleArn] = useState(
    metadata.remediationRoleArn,
  );
  const [prevAwsRegions, setPrevAwsRegions] = useState(metadata.regions);
  const [prevAwsTypeMeta, setPrevAwsTypeMeta] = useState(metadata.awsType);
  if (
    prevAwsConnection !== connection ||
    prevAwsRoleArn !== metadata.roleArn ||
    prevAwsRemediationRoleArn !== metadata.remediationRoleArn ||
    prevAwsRegions !== metadata.regions ||
    prevAwsTypeMeta !== metadata.awsType
  ) {
    setPrevAwsConnection(connection);
    setPrevAwsRoleArn(metadata.roleArn);
    setPrevAwsRemediationRoleArn(metadata.remediationRoleArn);
    setPrevAwsRegions(metadata.regions);
    setPrevAwsTypeMeta(metadata.awsType);
    if (connection) {
      const nextAwsType = typeof metadata.awsType === 'string' ? metadata.awsType : 'aws';
      setRoleArn((metadata.roleArn as string) ?? '');
      setRemediationRoleArn((metadata.remediationRoleArn as string) ?? '');
      setRegions(
        Array.isArray(metadata.regions)
          ? (metadata.regions as string[]).filter((region) =>
              nextAwsType === 'aws-us-gov'
                ? region.startsWith('us-gov-')
                : !region.startsWith('us-gov-'),
            )
          : [],
      );
      setAwsType(nextAwsType);
    }
  }

  const saveField = useCallback(
    async (
      creds: Record<string, string | string[]>,
      metaUpdates: Record<string, unknown>,
      setLoading: (v: boolean) => void,
      successMsg: string,
    ): Promise<boolean> => {
      setLoading(true);
      try {
        const result = await updateConnectionCredentials(connectionId, creds);
        if (!result.success) {
          toast.error(result.error || t('awsSettings.saveFailed'));
          return false;
        }
        if (Object.keys(metaUpdates).length > 0) {
          const metaResult = await updateConnectionMetadata(connectionId, metaUpdates);
          if (!metaResult.success) {
            toast.error(metaResult.error || t('awsSettings.saveFailed'));
            return false;
          }
        }
        toast.success(successMsg);
        onUpdated?.();
        return true;
      } catch {
        toast.error(t('awsSettings.saveFailed'));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [connectionId, updateConnectionCredentials, updateConnectionMetadata, onUpdated, t],
  );

  const handleSaveCredentials = useCallback(async () => {
    if (!roleArn.trim()) {
      toast.error(t('awsSettings.roleArnRequired'));
      return;
    }
    const expectedPrefix =
      awsEnvironment === 'aws-us-gov' ? 'arn:aws-us-gov:iam::' : 'arn:aws:iam::';
    if (!roleArn.startsWith(expectedPrefix)) {
      toast.error(t('awsSettings.roleArnEnvMismatch'));
      return;
    }
    const meta: Record<string, unknown> = { roleArn };
    const arnMatch = roleArn.match(/^arn:(?:aws|aws-us-gov):iam::(\d{12}):role\/.+$/);
    if (arnMatch) meta.accountId = arnMatch[1];
    await saveField({ roleArn }, meta, setSavingCredentials, t('awsSettings.credentialsSaved'));
  }, [awsEnvironment, roleArn, saveField, t]);

  const handleSaveRemediation = useCallback(async () => {
    const expectedPrefix =
      awsEnvironment === 'aws-us-gov' ? 'arn:aws-us-gov:iam::' : 'arn:aws:iam::';
    if (remediationRoleArn && !remediationRoleArn.startsWith(expectedPrefix)) {
      toast.error(t('awsSettings.remediationRoleArnEnvMismatch'));
      return;
    }
    await saveField(
      { remediationRoleArn },
      { remediationRoleArn },
      setSavingRemediation,
      t('awsSettings.remediationRoleSaved'),
    );
  }, [awsEnvironment, remediationRoleArn, saveField, t]);

  const handleSaveRemediationRoles = useCallback(
    async (serializedMap: string) => {
      // Server validates every entry fail-closed and syncs the parsed map
      // to metadata, so no metadata update is needed here — refetch on save.
      await saveField(
        { remediationRoles: serializedMap },
        {},
        setSavingRemediationRoles,
        t('awsSettings.remediationPairsSaved'),
      );
    },
    [saveField, t],
  );

  const handleSaveRegions = useCallback(async () => {
    if (regions.length === 0) {
      toast.error(t('awsSettings.selectAtLeastOneRegion'));
      return;
    }
    await saveField({ regions }, { regions }, setSavingRegions, t('awsSettings.regionsSaved'));
  }, [regions, saveField, t]);

  const handleSaveAwsType = useCallback(async () => {
    if (!awsType) {
      toast.error(t('awsSettings.selectEnvironment'));
      return;
    }
    // Send only the environment: the server merges with the stored vault
    // credentials and validates the full set, so wiping regions here would
    // guarantee a "No AWS regions selected" failure. A genuine partition
    // switch also needs a matching Role ARN and regions — the server's
    // partition-mismatch message tells the user exactly that.
    const saved = await saveField(
      { awsType },
      { awsType },
      setSavingAwsType,
      t('awsSettings.environmentSaved'),
    );
    // Only drop the local selection once the server accepts the switch —
    // clearing on failure orphans the user's region picks. On success the
    // refetch resyncs from metadata (filtered to the new partition).
    if (saved) setRegions([]);
  }, [awsType, saveField, t]);

  const handleDisconnect = useCallback(async () => {
    if (!confirm(t('awsSettings.confirmDisconnect'))) return;
    setDisconnecting(true);
    try {
      const result = await deleteConnection(connectionId);
      if (result.success) {
        toast.success(t('awsSettings.disconnected'));
        onUpdated?.();
      } else {
        toast.error(result.error || t('awsSettings.actionFailed'));
      }
    } catch {
      toast.error(t('awsSettings.actionFailed'));
    } finally {
      setDisconnecting(false);
    }
  }, [connectionId, deleteConnection, onUpdated, t]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 py-5">
      <div className="rounded-md border bg-muted/20 px-3 py-2.5 space-y-1">
        <AccountSettingsInfoRow
          label={t('awsSettings.status')}
          badge={
            connection?.status === 'active' ? (
              <Badge
                variant="outline"
                className="gap-1 text-[9px] px-1.5 py-0 border-emerald-200 bg-emerald-50 text-emerald-700"
              >
                <CheckCircle2 className="h-2.5 w-2.5" />
                {t('awsSettings.active')}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                {connection?.status}
              </Badge>
            )
          }
        />
        {accountId && (
          <AccountSettingsInfoRow label={t('awsSettings.accountId')} value={accountId} mono />
        )}
        {displayName && !accountId && (
          <AccountSettingsInfoRow label={t('awsSettings.account')} value={displayName} mono />
        )}
        {regions.length > 0 && (
          <AccountSettingsInfoRow label={t('awsSettings.regions')} value={`${regions.length}`} />
        )}
        {connection?.createdAt && (
          <AccountSettingsInfoRow
            label={t('awsSettings.created')}
            value={new Date(connection.createdAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          />
        )}
      </div>

      <AccountSettingsSection label={t('awsSettings.environmentSection')}>
        <AccountSettingsFieldGroup label={t('awsSettings.environmentSection')}>
          <CredentialInput
            field={{
              id: 'awsType',
              label: '',
              type: 'select',
              required: true,
              placeholder: t('awsSettings.selectEnvironmentPlaceholder'),
              helpText: t('awsSettings.environmentHelpText'),
              options: [
                { value: 'aws', label: t('awsSettings.commercialAws') },
                { value: 'aws-us-gov', label: t('awsSettings.govCloudUs') },
              ],
            }}
            value={awsType}
            onChange={(v) => setAwsType(v as string)}
          />
          <Button
            onClick={() => void handleSaveAwsType()}
            loading={savingAwsType}
            disabled={savingAwsType}
            size="sm"
          >
            {t('awsSettings.save')}
          </Button>
        </AccountSettingsFieldGroup>
      </AccountSettingsSection>

      <AccountSettingsSection label={t('awsSettings.credentialsSection')}>
        <AccountSettingsFieldGroup label={t('awsSettings.roleArnLabel')}>
          <CredentialInput
            field={{
              id: 'roleArn',
              label: '',
              type: 'text',
              required: true,
              placeholder: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
            }}
            value={roleArn}
            onChange={(v) => setRoleArn(v as string)}
          />
        </AccountSettingsFieldGroup>
        <AccountSettingsFieldGroup label={t('awsSettings.externalId')}>
          <p className="rounded-md border bg-muted/30 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
            {externalId || '—'}
          </p>
        </AccountSettingsFieldGroup>
        <Button
          onClick={() => void handleSaveCredentials()}
          loading={savingCredentials}
          disabled={savingCredentials}
          size="sm"
        >
          {t('awsSettings.save')}
        </Button>
      </AccountSettingsSection>

      <AccountSettingsSection label={t('awsSettings.autoRemediationSection')}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{t('awsSettings.status')}</span>
          {hasRemediation ? (
            <Badge
              variant="outline"
              className="gap-1 text-[9px] px-1.5 py-0 border-emerald-200 bg-emerald-50 text-emerald-700"
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              {t('awsSettings.configured')}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
              {t('awsSettings.notConfigured')}
            </Badge>
          )}
        </div>
        <RemediationRolesTable
          regions={regions}
          initialMap={remediationRolesMap}
          externalId={externalId}
          awsEnvironment={awsEnvironment}
          accountId={accountId}
          saving={savingRemediationRoles}
          onSave={handleSaveRemediationRoles}
        />
        {showLegacyBanner && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {t('awsSettings.legacyRemediationBanner')}
          </p>
        )}
        <CloudShellSetup
          script={remediationScript}
          externalId={externalId}
          cloudShellUrl={cloudShellUrl}
          disabled={!externalId}
          disabledMessage="No External ID on file for this connection — reconnect to issue one."
          title={t('awsSettings.setupScript')}
          subtitle={t('awsSettings.setupScriptSubtitle')}
          footnote=""
        />
        <AccountSettingsFieldGroup label={t('awsSettings.remediationRoleArnLabel')}>
          <CredentialInput
            field={{
              id: 'remediationRoleArn',
              label: '',
              type: 'text',
              required: false,
              placeholder: 'arn:aws:iam::123456789012:role/OpenComp-Remediator',
            }}
            value={remediationRoleArn}
            onChange={(v) => setRemediationRoleArn(v as string)}
          />
        </AccountSettingsFieldGroup>
        <Button
          onClick={() => void handleSaveRemediation()}
          loading={savingRemediation}
          disabled={savingRemediation}
          size="sm"
        >
          {t('awsSettings.save')}
        </Button>
      </AccountSettingsSection>

      {regionsField && (
        <AccountSettingsSection label={t('awsSettings.scanRegionsSection')}>
          <CredentialInput
            field={regionsField}
            value={regions}
            onChange={(v) => setRegions(v as string[])}
            optionsOverride={filteredRegionOptions}
          />
          <Button
            onClick={() => void handleSaveRegions()}
            loading={savingRegions}
            disabled={savingRegions}
            size="sm"
          >
            {t('awsSettings.save')}
          </Button>
        </AccountSettingsSection>
      )}

      <div className="rounded-md border border-destructive/20 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
            <div>
              <p className="text-xs font-medium">{t('awsSettings.disconnect')}</p>
              <p className="text-[10px] text-muted-foreground">
                {t('awsSettings.disconnectDescription')}
              </p>
            </div>
          </div>
          <Button
            variant="destructive"
            onClick={() => void handleDisconnect()}
            loading={disconnecting}
            disabled={disconnecting}
            size="sm"
          >
            {t('awsSettings.disconnect')}
          </Button>
        </div>
      </div>
    </div>
  );
}
