import { describe, expect, it } from 'vitest';
import { isGcpAllowlistedFixStep } from '../remediation-allowlist';
import {
  APPROVAL_GATED_GCP_ASSET_CLASSES,
  MAX_GCP_REMEDIATION_PAIRS,
  gcpFindingToAssetClass,
  gcpRemediationKey,
  gcpRemediationRoleId,
  gcpRemediationSaEmail,
  getGcpRemediationMapParseError,
  isApprovalGatedGcpAssetClass,
  isGcpRemediationKey,
  normalizeGcpRemediationKey,
  parseGcpRemediationMap,
  serializeGcpRemediationMap,
} from '../remediation-roles';
import { getGcpRemediationScriptForPair } from '../remediation-script';

describe('gcpFindingToAssetClass', () => {
  it('maps native check resource types to their class', () => {
    expect(gcpFindingToAssetClass('gcp-storage-bucket')).toBe('Storage');
    expect(gcpFindingToAssetClass('gcp-cloud-sql-instance')).toBe('Data');
    expect(gcpFindingToAssetClass('gcp-firewall-rule')).toBe('Network');
    expect(gcpFindingToAssetClass('gcp-bigquery-dataset')).toBe('Data');
    expect(gcpFindingToAssetClass('gcp-kms-key')).toBe('Security-Global');
    expect(gcpFindingToAssetClass('gcp-project')).toBe('Security-Global');
    expect(gcpFindingToAssetClass('gcp-environment-separation')).toBe('Security-Global');
  });

  it('fails closed to Security-Global for unknown or non-string types', () => {
    expect(gcpFindingToAssetClass('gcp-totally-new-service')).toBe('Security-Global');
    expect(gcpFindingToAssetClass('')).toBe('Security-Global');
    expect(gcpFindingToAssetClass(undefined)).toBe('Security-Global');
    expect(gcpFindingToAssetClass(null)).toBe('Security-Global');
    expect(gcpFindingToAssetClass(42)).toBe('Security-Global');
  });

  it('fails closed on Object.prototype members instead of misrouting', () => {
    expect(gcpFindingToAssetClass('toString')).toBe('Security-Global');
    expect(gcpFindingToAssetClass('constructor')).toBe('Security-Global');
    expect(gcpFindingToAssetClass('__proto__')).toBe('Security-Global');
  });
});

describe('approval gates', () => {
  it('gates Network and Security-Global only', () => {
    expect(APPROVAL_GATED_GCP_ASSET_CLASSES).toEqual(
      expect.arrayContaining(['Network', 'Security-Global']),
    );
    expect(isApprovalGatedGcpAssetClass('Network')).toBe(true);
    expect(isApprovalGatedGcpAssetClass('Security-Global')).toBe(true);
    expect(isApprovalGatedGcpAssetClass('Storage')).toBe(false);
    expect(isApprovalGatedGcpAssetClass('Compute')).toBe(false);
    expect(isApprovalGatedGcpAssetClass('Data')).toBe(false);
  });
});

describe('keys and emails', () => {
  it('builds keys and SA emails, rejecting bad projects', () => {
    expect(gcpRemediationKey({ assetClass: 'Storage', projectId: 'my-proj-123' })).toBe(
      'Storage:my-proj-123',
    );
    expect(gcpRemediationSaEmail({ projectId: 'my-proj-123' })).toBe(
      'opencomp-remediator@my-proj-123.iam.gserviceaccount.com',
    );
    expect(() => gcpRemediationKey({ assetClass: 'Storage', projectId: 'BAD!!' })).toThrow();
    expect(() => gcpRemediationSaEmail({ projectId: '' })).toThrow();
  });

  it('validates key shape', () => {
    expect(isGcpRemediationKey('Storage:my-proj-123')).toBe(true);
    expect(isGcpRemediationKey('Security-Global:my-proj-123')).toBe(true);
    expect(isGcpRemediationKey('Bogus:my-proj-123')).toBe(false);
    expect(isGcpRemediationKey('Storage:BAD!!')).toBe(false);
    expect(isGcpRemediationKey('Storage:')).toBe(false);
    expect(isGcpRemediationKey('no-separator')).toBe(false);
  });

  it('builds custom role ids', () => {
    expect(gcpRemediationRoleId({ assetClass: 'Storage' })).toBe('opencomp.remediator.storage');
    expect(gcpRemediationRoleId({ assetClass: 'Security-Global' })).toBe(
      'opencomp.remediator.securityGlobal',
    );
  });
});

describe('pair map parse/validate', () => {
  const email = 'opencomp-remediator@my-proj-123.iam.gserviceaccount.com';

  it('parses a valid map and drops invalid entries', () => {
    expect(parseGcpRemediationMap(JSON.stringify({ 'Storage:my-proj-123': email }))).toEqual({
      'Storage:my-proj-123': email,
    });
    expect(parseGcpRemediationMap('garbage')).toEqual({});
    expect(parseGcpRemediationMap(undefined)).toEqual({});
    // Invalid key / non-SA email are dropped (fail closed to unbound)
    expect(
      parseGcpRemediationMap(
        JSON.stringify({
          'Bogus:my-proj-123': email,
          'Storage:my-proj-123': 'not-an-sa',
        }),
      ),
    ).toEqual({});
  });

  it('surfaces malformed input instead of passing empty', () => {
    expect(
      getGcpRemediationMapParseError(JSON.stringify({ 'Storage:my-proj-123': email })),
    ).toBeNull();
    expect(getGcpRemediationMapParseError('')).toBeNull();
    expect(getGcpRemediationMapParseError(undefined)).toBeNull();
    expect(getGcpRemediationMapParseError('not-json')).toMatch(/must be a JSON object/);
    expect(getGcpRemediationMapParseError(JSON.stringify({ 'Bogus:my-proj-123': email }))).toMatch(
      /must be "<AssetClass>:<project>"/,
    );
    expect(
      getGcpRemediationMapParseError(JSON.stringify({ 'Storage:my-proj-123': 'nope' })),
    ).toMatch(/service-account email/);
  });

  it('round-trips through serialize', () => {
    const map = { 'Storage:my-proj-123': email };
    expect(parseGcpRemediationMap(serializeGcpRemediationMap(map))).toEqual(map);
  });

  it('canonicalizes inner whitespace so stored keys match lookup keys', () => {
    // A pasted key with a space after the colon must resolve to the same
    // binding the executor looks up — not pass validation and then miss.
    expect(isGcpRemediationKey('Storage: my-proj-123')).toBe(true);
    expect(normalizeGcpRemediationKey('Storage: my-proj-123')).toBe('Storage:my-proj-123');
    expect(parseGcpRemediationMap(JSON.stringify({ 'Storage: my-proj-123': email }))).toEqual({
      'Storage:my-proj-123': email,
    });
  });

  it('flags canonical duplicates the same way parse collapses them', () => {
    // `"Storage: p"` and `"Storage:p"` are one binding after
    // canonicalization — the validator must error, matching parse's
    // last-wins collapse, instead of passing two spellings through.
    expect(
      getGcpRemediationMapParseError(
        JSON.stringify({ 'Storage: my-proj-123': email, 'Storage:my-proj-123': email }),
      ),
    ).toMatch(/duplicate key/);
  });

  it('caps the binding count so one request cannot force unbounded probes', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i <= MAX_GCP_REMEDIATION_PAIRS; i++) {
      big[`Storage:proj-${String(i).padStart(3, '0')}x`] =
        `opencomp-remediator@proj-${String(i).padStart(3, '0')}x.iam.gserviceaccount.com`;
    }
    expect(getGcpRemediationMapParseError(JSON.stringify(big))).toMatch(/too many bindings/);
    const ok: Record<string, string> = { 'Storage:my-proj-123': email };
    expect(getGcpRemediationMapParseError(JSON.stringify(ok))).toBeNull();
  });
});

describe('isGcpAllowlistedFixStep', () => {
  it('allows class-scoped writes and refuses cross-class ones', () => {
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBe(true);
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://compute.googleapis.com/compute/v1/projects/p/zones/z/instances/i',
      }),
    ).toBe(false);
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Data',
        method: 'GET',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBe(false);
  });
});

describe('getGcpRemediationScriptForPair', () => {
  it('renders project-scoped gcloud commands with no keys', () => {
    const script = getGcpRemediationScriptForPair({
      pair: { assetClass: 'Storage', projectId: 'my-proj-123' },
      impersonatorServiceAccount: 'backend@sys.iam.gserviceaccount.com',
    });
    expect(script).toContain('PROJECT="my-proj-123"');
    expect(script).toContain('opencomp-remediator@my-proj-123.iam.gserviceaccount.com');
    expect(script).toContain('roles/iam.serviceAccountTokenCreator');
    expect(script).not.toMatch(/gcloud iam service-accounts keys create/);
  });

  it('warns on approval-gated classes', () => {
    const script = getGcpRemediationScriptForPair({
      pair: { assetClass: 'Security-Global', projectId: 'my-proj-123' },
      impersonatorServiceAccount: 'backend@sys.iam.gserviceaccount.com',
    });
    expect(script).toMatch(/approval-gated/);
  });
});
