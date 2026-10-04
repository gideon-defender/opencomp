'use client';

import { CloudShellSetup } from '@/components/integrations/CloudShellSetup';
import { CredentialInput } from '@/components/integrations/CredentialInput';
import {
  REMEDIATION_ASSET_CLASSES,
  SAFE_AWS_REGION_PATTERN,
  getAwsCloudShellUrl,
  getAwsRemediationScriptForPair,
  parseRemediationRolesMap,
  remediationRoleKey,
  remediationRoleName,
  serializeRemediationRolesMap,
  type AwsEnvironment,
  type RemediationAssetClass,
} from '@gideon-defender/integration-platform';
import { Badge } from '@gideon-defender/ui/badge';
import { Button } from '@gideon-defender/ui/button';
import { CheckCircle2, Loader2, Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

interface PairRow {
  key: string;
  assetClass: RemediationAssetClass;
  region: string;
  roleName: string;
  isGlobal: boolean;
}

function buildRows(regions: string[]): PairRow[] {
  const rows: PairRow[] = [];
  for (const region of regions) {
    for (const assetClass of REMEDIATION_ASSET_CLASSES) {
      if (assetClass === 'Security-Global') continue;
      rows.push({
        key: remediationRoleKey({ assetClass, region }),
        assetClass,
        region,
        roleName: remediationRoleName({ assetClass, region }),
        isGlobal: false,
      });
    }
  }
  rows.push({
    key: remediationRoleKey({ assetClass: 'Security-Global', region: 'us-east-1' }),
    assetClass: 'Security-Global',
    region: 'us-east-1',
    roleName: remediationRoleName({ assetClass: 'Security-Global', region: 'us-east-1' }),
    isGlobal: true,
  });
  return rows;
}

/**
 * Per asset-class x region remediation role table. Findings route to the
 * matching pair role (map first, legacy fallback) — create only the pairs
 * to auto-fix in. The map serializes to the `remediationRoles` credential
 * (JSON string); the server validates every entry fail-closed on save.
 */
export function RemediationRolesTable({
  regions,
  initialMap,
  externalId,
  awsEnvironment,
  accountId,
  saving,
  onSave,
}: {
  regions: string[];
  initialMap: Record<string, string>;
  externalId: string;
  awsEnvironment: AwsEnvironment;
  /** Auditor account — pair ARNs outside it are rejected client-side too. */
  accountId?: string;
  saving: boolean;
  onSave: (serializedMap: string) => Promise<void>;
}) {
  const t = useTranslations('integrations');
  const [draft, setDraft] = useState<Record<string, string>>(initialMap);
  const [scriptKey, setScriptKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Resync the draft when the saved map changes underneath. Compares by
  // serialized value, not by reference: the parent derives initialMap via
  // parseRemediationRolesMap on every render (a fresh object each time),
  // so a reference compare would wipe in-progress edits on any parent
  // re-render (typing in a sibling field, SWR revalidation).
  const [prevSerializedMap, setPrevSerializedMap] = useState(() =>
    serializeRemediationRolesMap(initialMap),
  );
  const serializedInitialMap = serializeRemediationRolesMap(initialMap);
  if (prevSerializedMap !== serializedInitialMap) {
    setPrevSerializedMap(serializedInitialMap);
    setDraft(initialMap);
    setScriptKey(null);
  }

  // Drop regions outside the IAM-safe charset before minting role names:
  // buildRows throws on them, and one corrupt stored value must not
  // unmount the whole settings section. Dropped regions are surfaced
  // below so they stay visible instead of silently vanishing.
  const safeRegions = useMemo(
    () => regions.filter((region) => SAFE_AWS_REGION_PATTERN.test(region.trim())),
    [regions],
  );
  const droppedRegions = useMemo(
    () => regions.filter((region) => !SAFE_AWS_REGION_PATTERN.test(region.trim())),
    [regions],
  );
  const rows = useMemo(() => buildRows(safeRegions), [safeRegions]);
  const cloudShellUrl = getAwsCloudShellUrl(awsEnvironment);
  const expectedPrefix = awsEnvironment === 'aws-us-gov' ? 'arn:aws-us-gov:iam::' : 'arn:aws:iam::';
  // IAM charset only (word chars plus `+=,.@-`, `/` for paths): every shell
  // metacharacter is rejected so a pasted value cannot poison scripts. The
  // server re-validates with the same charset on save.
  const arnPattern = /^arn:(aws|aws-us-gov):iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]+$/;

  const configuredCount = rows.filter((row) => draft[row.key]?.trim()).length;

  const handleSave = () => {
    // Save visible rows only: the draft also carries orphan keys for
    // regions that no longer exist (or never validated), which have no
    // row to edit or clear. Re-saving them would make them undeletable
    // and let one stale entry fail the whole map server-side.
    const visibleKeys = new Set(rows.map((row) => row.key));
    const visibleDraft = Object.fromEntries(
      Object.entries(draft).filter(([key]) => visibleKeys.has(key)),
    );
    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const cleaned = parseRemediationRolesMap(visibleDraft);
    for (const [key, arn] of Object.entries(cleaned)) {
      if (!arnPattern.test(arn)) {
        setRowError(t('awsSettings.pairInvalidArn'));
        return;
      }
      if (!arn.startsWith(expectedPrefix)) {
        setRowError(t('awsSettings.remediationRoleArnEnvMismatch'));
        return;
      }
      if (accountId && !arn.includes(`:${accountId}:`)) {
        setRowError(t('awsSettings.remediationRoleArnAccountMismatch'));
        return;
      }
      // Exact-pair binding (same rule the server enforces): a valid ARN
      // from another pair must not pass client validation, or a correct
      // visible edit fails with a map-level server error instead.
      const pastedRoleName = arn.split('/').pop() ?? '';
      const expectedRoleName = rowByKey.get(key)?.roleName;
      if (expectedRoleName && pastedRoleName !== expectedRoleName) {
        setRowError(t('awsSettings.pairRoleMismatch', { roleName: expectedRoleName }));
        return;
      }
    }
    setRowError(null);
    void onSave(serializeRemediationRolesMap(cleaned));
  };

  const selectedRow = rows.find((row) => row.key === scriptKey) ?? null;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        {t('awsSettings.remediationPairsDescription')}
      </p>
      {droppedRegions.length > 0 && (
        <p className="text-[11px] text-amber-700">
          {t('awsSettings.pairInvalidRegions', { regions: droppedRegions.join(', ') })}
        </p>
      )}
      <div className="rounded-md border divide-y">
        {rows.map((row) => {
          const value = draft[row.key] ?? '';
          const configured = Boolean(value.trim());
          return (
            <div key={row.key} className="px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">
                    {row.assetClass}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground truncate">
                    {row.region}
                  </span>
                  {row.isGlobal && (
                    <Badge
                      variant="outline"
                      className="gap-1 text-[9px] px-1.5 py-0 border-amber-200 bg-amber-50 text-amber-700 shrink-0"
                    >
                      {t('awsSettings.pairApprovalRequired')}
                    </Badge>
                  )}
                </div>
                {configured ? (
                  <Badge
                    variant="outline"
                    className="gap-1 text-[9px] px-1.5 py-0 border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0"
                  >
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {t('awsSettings.configured')}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">
                    {t('awsSettings.notConfigured')}
                  </Badge>
                )}
              </div>
              <p className="font-mono text-[10px] text-muted-foreground truncate">{row.roleName}</p>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <CredentialInput
                    field={{
                      id: `remediationRoles.${row.key}`,
                      label: '',
                      type: 'text',
                      required: false,
                      placeholder: `${expectedPrefix}123456789012:role/${row.roleName}`,
                    }}
                    value={value}
                    onChange={(v) => {
                      setDraft((prev) => ({ ...prev, [row.key]: v as string }));
                      setRowError(null);
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScriptKey((prev) => (prev === row.key ? null : row.key))}
                >
                  <Terminal className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {selectedRow && (
        <CloudShellSetup
          script={getAwsRemediationScriptForPair(awsEnvironment, {
            assetClass: selectedRow.assetClass,
            region: selectedRow.region,
          })}
          externalId={externalId}
          cloudShellUrl={cloudShellUrl}
          title={t('awsSettings.pairSetupScript')}
          subtitle={selectedRow.roleName}
          footnote=""
        />
      )}
      {rowError && <p className="text-[11px] text-red-600">{rowError}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          {t('awsSettings.save')}
        </Button>
        <span className="text-[10px] text-muted-foreground">
          {configuredCount}/{rows.length} {t('awsSettings.configured').toLowerCase()}
        </span>
      </div>
    </div>
  );
}
