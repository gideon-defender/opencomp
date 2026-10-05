'use client';

import {
  getAwsCloudShellUrl,
  getAwsRemediationScriptForPair,
  isApprovalGatedAssetClass,
  parseRemediationRolesMap,
  remediationRoleKey,
  remediationRoleName,
  serializeRemediationRolesMap,
  type AwsEnvironment,
  type RemediationAssetClass,
} from '@gideon-defender/integration-platform';
import { useMemo, useState } from 'react';
import { RemediationPairPicker } from './RemediationPairPicker';
import { RemediationScriptPanel } from './RemediationScriptPanel';

/**
 * Inline per-pair remediation setup for the AWS onboarding flows (connect
 * dialog + empty-state onboarding). Collects one role ARN per
 * asset-class/region pair into the serialized `remediationRoles` map — the
 * removed single `remediationRoleArn` is never offered, so new
 * connections cannot be born on the monolith role.
 *
 * Unlike `RemediationSetupDialog` (settings, existing connection) this owns
 * no server state: pairs accumulate locally and the parent submits the map
 * with the connection credentials. The server re-validates every entry.
 */
export function RemediationPairSetup({
  awsEnvironment,
  externalId,
  regions,
  value,
  onChange,
  scriptEnabled,
  disabledMessage = 'Select an AWS environment before copying the setup script.',
}: {
  /** Normalized environment (`aws` or `aws-us-gov`) for script + ARN checks. */
  awsEnvironment: AwsEnvironment;
  /** Server-issued External ID baked into the pair script. */
  externalId: string;
  /** Scan regions selected on the connection — the pair region picker. */
  regions: string[];
  /** Serialized `remediationRoles` map (`''` when no pair is configured). */
  value: string;
  onChange: (next: string) => void;
  /** False until the connection's External ID is issued (phase 1). */
  scriptEnabled: boolean;
  disabledMessage?: string;
}) {
  const [assetClass, setAssetClass] = useState<RemediationAssetClass>('Storage');
  const [region, setRegion] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [error, setError] = useState<string | null>(null);

  const configuredMap = useMemo(() => parseRemediationRolesMap(value), [value]);

  // Reset the pending ARN input when the parent clears the form (after a
  // successful connect, or on reopen) so stale text cannot attach to new
  // pairs. Adjusted during render (same pattern as CloudShellSetup) — the
  // string comparison converges immediately, so this never loops.
  const [clearedValue, setClearedValue] = useState(value);
  if (value !== clearedValue) {
    setClearedValue(value);
    if (!value) {
      setRoleArn('');
      setError(null);
    }
  }

  // Derive the pair region from the connection's selected scan regions: an
  // explicit pick wins while selected, otherwise fall back to the first
  // region (covers environment switches, which reset the region list).
  const resolvedRegion = regions.includes(region) ? region : (regions[0] ?? '');

  const pairKey = useMemo(() => {
    const effectiveRegion = assetClass === 'Security-Global' ? 'us-east-1' : resolvedRegion.trim();
    if (!effectiveRegion) return null;
    try {
      return remediationRoleKey({ assetClass, region: effectiveRegion });
    } catch {
      return null;
    }
  }, [assetClass, resolvedRegion]);

  const pairRoleName = useMemo(() => {
    const effectiveRegion = assetClass === 'Security-Global' ? 'us-east-1' : resolvedRegion.trim();
    if (!effectiveRegion) return null;
    try {
      return remediationRoleName({ assetClass, region: effectiveRegion });
    } catch {
      return null;
    }
  }, [assetClass, resolvedRegion]);

  const pairScript = useMemo(() => {
    const effectiveRegion = assetClass === 'Security-Global' ? 'us-east-1' : resolvedRegion.trim();
    if (!pairKey || !effectiveRegion) return '';
    // The builder shell-escapes the value — never interpolate it here.
    return getAwsRemediationScriptForPair(
      awsEnvironment,
      { assetClass, region: effectiveRegion },
      externalId,
    );
  }, [awsEnvironment, assetClass, resolvedRegion, pairKey, externalId]);

  const cloudShellUrl = getAwsCloudShellUrl(awsEnvironment);
  const configuredKeys = Object.keys(configuredMap);

  const handleAddPair = () => {
    if (!roleArn.trim() || !pairKey) return;

    const arnPattern = /^arn:(aws|aws-us-gov):iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]+$/;
    if (!arnPattern.test(roleArn.trim())) {
      setError('Invalid ARN format. Expected an AWS IAM role ARN.');
      return;
    }
    const expectedPrefix =
      awsEnvironment === 'aws-us-gov' ? 'arn:aws-us-gov:iam::' : 'arn:aws:iam::';
    if (!roleArn.trim().startsWith(expectedPrefix)) {
      setError('ARN environment does not match this connection.');
      return;
    }
    // Enforce the exact pair role — pasting another pair's role would
    // silently attach a wider-blast-radius role to this pair.
    if (pairRoleName) {
      const pastedRoleName = roleArn.trim().split('/').pop() ?? '';
      if (pastedRoleName !== pairRoleName) {
        setError(`ARN must reference the "${pairRoleName}" role for this pair.`);
        return;
      }
    }

    onChange(serializeRemediationRolesMap({ ...configuredMap, [pairKey]: roleArn.trim() }));
    setRoleArn('');
    setError(null);
  };

  const handleRemovePair = (key: string) => {
    const rest = { ...configuredMap };
    delete rest[key];
    onChange(serializeRemediationRolesMap(rest));
  };

  return (
    <div className="space-y-4">
      <RemediationPairPicker
        assetClass={assetClass}
        region={resolvedRegion}
        regions={regions}
        onAssetClassChange={setAssetClass}
        onRegionChange={setRegion}
      />
      {pairRoleName && (
        <p className="font-mono text-[11px] text-muted-foreground">
          Role: {pairRoleName}
          {isApprovalGatedAssetClass(assetClass) && ' — human approval required'}
        </p>
      )}
      {configuredKeys.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {configuredKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleRemovePair(key)}
              title="Remove this pair"
              className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary hover:bg-destructive/10 hover:text-destructive"
            >
              {key} ✕
            </button>
          ))}
        </div>
      )}

      {!scriptEnabled ? (
        <p className="text-xs text-muted-foreground">{disabledMessage}</p>
      ) : (
        <RemediationScriptPanel script={pairScript} cloudShellUrl={cloudShellUrl} />
      )}

      <div className="space-y-2">
        <label htmlFor="remediation-pair-role-arn" className="text-xs font-medium">
          Pair Role ARN{pairKey ? ` (${pairKey})` : ''}
        </label>
        <div className="flex gap-2">
          <input
            id="remediation-pair-role-arn"
            type="text"
            placeholder={
              pairRoleName
                ? `arn:aws:iam::123456789012:role/${pairRoleName}`
                : 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1'
            }
            value={roleArn}
            onChange={(e) => {
              setRoleArn(e.target.value);
              setError(null);
            }}
            disabled={!scriptEnabled}
            className="flex-1 rounded-md border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleAddPair}
            disabled={!roleArn.trim() || !pairKey || !scriptEnabled}
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error && <p className="text-[11px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}
