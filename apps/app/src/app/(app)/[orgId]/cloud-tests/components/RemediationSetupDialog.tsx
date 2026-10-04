'use client';

import { useApi } from '@/hooks/use-api';
import {
  getAwsCloudShellUrl,
  getAwsRemediationScriptForPair,
  normalizeAwsEnvironment,
  parseRemediationRolesMap,
  remediationRoleKey,
  remediationRoleName,
  serializeRemediationRolesMap,
  type RemediationAssetClass,
} from '@gideon-defender/integration-platform';
import { Badge } from '@gideon-defender/ui/badge';
import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import { Loader2, Terminal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RemediationPairPicker } from '@/components/remediation/RemediationPairPicker';
import { RemediationScriptPanel } from '@/components/remediation/RemediationScriptPanel';

export function RemediationSetupDialog({
  open,
  onOpenChange,
  orgId,
  connectionId,
  awsType,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  connectionId: string;
  awsType?: string;
  onSaved?: () => void;
}) {
  // Destructure the memoized client methods: useApi() returns a fresh object
  // every render, so an effect that depends on `api` would refire on every
  // render and reset the region/ARN state below. get/put are useCallback-
  // stable, so they are safe effect dependencies.
  const { get: apiGet, put: apiPut } = useApi();
  const [roleArn, setRoleArn] = useState('');
  const [assetClass, setAssetClass] = useState<RemediationAssetClass>('Storage');
  const [region, setRegion] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const [existingMap, setExistingMap] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const awsEnvironment = normalizeAwsEnvironment(awsType);

  // Load the connection's regions + already-configured pairs when opened so
  // the region picker and the save-merge both reflect server state.
  useEffect(() => {
    if (!open || !connectionId) return;
    let cancelled = false;
    apiGet<{ metadata?: Record<string, unknown> }>(`/v1/connections/${connectionId}`)
      .then((resp) => {
        if (cancelled) return;
        if (resp.error) {
          setSaveError('Failed to load connection regions. Check the connection and reopen.');
          return;
        }
        const metadata = (resp.data?.metadata ?? {}) as Record<string, unknown>;
        const nextRegions = Array.isArray(metadata.regions)
          ? (metadata.regions as string[]).filter((r) => typeof r === 'string' && r)
          : [];
        if (cancelled) return;
        setRegions(nextRegions);
        // Always reset to the freshly loaded connection: the dialog stays
        // mounted across opens, so keeping the previous region/ARN would
        // mint a script for the wrong region and save under the wrong
        // pair key (or into another connection entirely).
        setRegion(nextRegions[0] || '');
        setRoleArn('');
        setSaveError(null);
        setExistingMap(parseRemediationRolesMap(metadata.remediationRoles));
      })
      .catch(() => {
        if (!cancelled) {
          setSaveError('Failed to load connection regions. Check the connection and reopen.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, connectionId, apiGet]);

  const pairKey = useMemo(() => {
    // The global pair is pinned to us-east-1 and needs no region selection —
    // without this bypass an empty region list dead-ends even global setup.
    const effectiveRegion = assetClass === 'Security-Global' ? 'us-east-1' : region.trim();
    if (!effectiveRegion) return null;
    try {
      return remediationRoleKey({ assetClass, region: effectiveRegion });
    } catch {
      return null;
    }
  }, [assetClass, region]);
  const pairRoleName = useMemo(() => {
    const effectiveRegion = assetClass === 'Security-Global' ? 'us-east-1' : region.trim();
    if (!effectiveRegion) return null;
    try {
      return remediationRoleName({ assetClass, region: effectiveRegion });
    } catch {
      return null;
    }
  }, [assetClass, region]);

  const finalScript = useMemo(() => {
    const effectiveRegion = assetClass === 'Security-Global' ? 'us-east-1' : region.trim();
    // Pass orgId as the external ID argument so it goes through the
    // builder's shell escaping — a raw replace here would let quotes or
    // `$()` in the value break out of `EXTERNAL_ID="..."` in CloudShell.
    return pairKey && effectiveRegion
      ? getAwsRemediationScriptForPair(
          awsEnvironment,
          {
            assetClass,
            region: effectiveRegion,
          },
          orgId,
        )
      : '';
  }, [awsEnvironment, assetClass, region, pairKey, orgId]);
  const cloudShellUrl = getAwsCloudShellUrl(awsEnvironment);

  const handleSaveRoleArn = useCallback(async () => {
    if (!roleArn.trim() || !connectionId || !pairKey) return;

    const arnPattern = /^arn:(aws|aws-us-gov):iam::\d{12}:role\/[A-Za-z0-9_+=,.@/-]+$/;
    if (!arnPattern.test(roleArn.trim())) {
      setSaveError('Invalid ARN format. Expected an AWS IAM role ARN.');
      return;
    }
    const expectedPrefix =
      awsEnvironment === 'aws-us-gov' ? 'arn:aws-us-gov:iam::' : 'arn:aws:iam::';
    if (!roleArn.trim().startsWith(expectedPrefix)) {
      setSaveError('ARN environment does not match this connection.');
      return;
    }
    // Enforce the exact pair role — pasting another pair's role would
    // silently promote the finding to a wider-blast-radius role. The
    // server re-validates the same binding on save.
    if (pairRoleName) {
      const pastedRoleName = roleArn.trim().split('/').pop() ?? '';
      if (pastedRoleName !== pairRoleName) {
        setSaveError(`ARN must reference the "${pairRoleName}" role for this pair.`);
        return;
      }
    }

    setSaving(true);
    setSaveError(null);
    try {
      const merged = serializeRemediationRolesMap({
        ...existingMap,
        [pairKey]: roleArn.trim(),
      });
      const resp = await apiPut(`/v1/connections/${connectionId}/credentials`, {
        credentials: { remediationRoles: merged },
      });
      if (resp.error) {
        setSaveError(typeof resp.error === 'string' ? resp.error : 'Failed to save Role ARN');
        return;
      }
      toast.success('Remediation Role ARN saved');
      setRoleArn('');
      setExistingMap(parseRemediationRolesMap(merged));
      onSaved?.();
    } catch {
      setSaveError('Failed to save Role ARN');
    } finally {
      setSaving(false);
    }
  }, [apiPut, connectionId, roleArn, pairKey, pairRoleName, existingMap, awsEnvironment, onSaved]);

  const handleRoleArnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRoleArn(e.target.value);
    setSaveError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enable Auto-Remediation</DialogTitle>
          <DialogDescription>
            Set up a remediation IAM role to enable auto-fix capabilities for your AWS security
            findings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <Terminal className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Remediation Role Setup</p>
                <p className="text-xs text-muted-foreground">
                  Create a write-access IAM role for auto-fix — one per asset class and region
                </p>
              </div>
            </div>

            <RemediationPairPicker
              assetClass={assetClass}
              region={region}
              regions={regions}
              onAssetClassChange={setAssetClass}
              onRegionChange={setRegion}
            />
            {pairRoleName && (
              <p className="font-mono text-[11px] text-muted-foreground">
                Role: {pairRoleName}
                {assetClass === 'Security-Global' && ' — human approval required'}
              </p>
            )}
            {Object.keys(existingMap).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(existingMap).map((key) => (
                  <Badge key={key} variant="secondary" className="text-[9px] px-1.5 py-0 font-mono">
                    {key}
                  </Badge>
                ))}
              </div>
            )}

            <RemediationScriptPanel script={finalScript} cloudShellUrl={cloudShellUrl} />
          </div>

          {/* Role ARN input */}
          <div className="space-y-2">
            <label htmlFor="remediation-role-arn" className="text-xs font-medium">
              Remediation Role ARN{pairKey ? ` (${pairKey})` : ''}
            </label>
            <div className="flex gap-2">
              <input
                id="remediation-role-arn"
                type="text"
                placeholder={
                  pairRoleName
                    ? `arn:aws:iam::123456789012:role/${pairRoleName}`
                    : 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1'
                }
                value={roleArn}
                onChange={handleRoleArnChange}
                className="flex-1 rounded-md border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <Button
                size="sm"
                onClick={handleSaveRoleArn}
                disabled={!roleArn.trim() || !pairKey || saving}
              >
                {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Save
              </Button>
            </div>
            {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}
          </div>

          <p className="text-[10px] text-muted-foreground/70 text-center">
            The remediation role is separate from your audit role — your audit role stays read-only.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
