'use client';

import {
  REMEDIATION_ASSET_CLASSES,
  type RemediationAssetClass,
} from '@gideon-defender/integration-platform';

/**
 * Asset-class + region picker for one remediation pair. The
 * `Security-Global` class is pinned to us-east-1 and needs no region
 * selection.
 */
export function RemediationPairPicker({
  assetClass,
  region,
  regions,
  onAssetClassChange,
  onRegionChange,
}: {
  assetClass: RemediationAssetClass;
  region: string;
  regions: string[];
  onAssetClassChange: (assetClass: RemediationAssetClass) => void;
  onRegionChange: (region: string) => void;
}) {
  const handleAssetClassChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onAssetClassChange(e.target.value as RemediationAssetClass);
  };
  const handleRegionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onRegionChange(e.target.value);
  };
  const isGlobal = assetClass === 'Security-Global';

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <label htmlFor="remediation-asset-class" className="text-xs font-medium">
          Asset class
        </label>
        <select
          id="remediation-asset-class"
          value={assetClass}
          onChange={handleAssetClassChange}
          className="w-full rounded-md border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {REMEDIATION_ASSET_CLASSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="remediation-region" className="text-xs font-medium">
          Region
        </label>
        <select
          id="remediation-region"
          value={isGlobal ? 'us-east-1' : region}
          disabled={isGlobal || regions.length === 0}
          onChange={handleRegionChange}
          className="w-full rounded-md border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        >
          {isGlobal ? (
            <option value="us-east-1">us-east-1 (pinned)</option>
          ) : (
            regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))
          )}
        </select>
      </div>
    </div>
  );
}
