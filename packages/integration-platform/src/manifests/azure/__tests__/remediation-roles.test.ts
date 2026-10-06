import { describe, expect, it } from 'vitest';
import {
  APPROVAL_GATED_AZURE_ASSET_CLASSES,
  AZURE_REMEDIATION_ASSET_CLASSES,
  azureFindingToAssetClass,
  azureRemediationKey,
  azureRemediatorSpName,
  getAzureRemediationMapParseError,
  isApprovalGatedAzureAssetClass,
  isAzureRemediationKey,
  MAX_AZURE_REMEDIATION_PAIRS,
  normalizeAzureRemediationKey,
  parseAzureRemediationKey,
  parseAzureRemediationMap,
  parseAzureRemediationSecrets,
  serializeAzureRemediationMap,
} from '../remediation-roles';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('azure asset classes', () => {
  it('covers the shared five classes', () => {
    expect([...AZURE_REMEDIATION_ASSET_CLASSES].sort()).toEqual(
      ['Compute', 'Data', 'Network', 'Security-Global', 'Storage'].sort(),
    );
  });

  it('gates Network and Security-Global only', () => {
    expect([...APPROVAL_GATED_AZURE_ASSET_CLASSES].sort()).toEqual(
      ['Network', 'Security-Global'].sort(),
    );
    expect(isApprovalGatedAzureAssetClass('Network')).toBe(true);
    expect(isApprovalGatedAzureAssetClass('Security-Global')).toBe(true);
    expect(isApprovalGatedAzureAssetClass('Storage')).toBe(false);
    expect(isApprovalGatedAzureAssetClass('Compute')).toBe(false);
    expect(isApprovalGatedAzureAssetClass('Data')).toBe(false);
  });
});

describe('azureFindingToAssetClass', () => {
  it('routes measured check types', () => {
    expect(azureFindingToAssetClass('azure-storage-account')).toBe('Storage');
    expect(azureFindingToAssetClass('azure-sql-server')).toBe('Data');
    expect(azureFindingToAssetClass('azure-postgresql-flexible-server')).toBe('Data');
    expect(azureFindingToAssetClass('azure-mysql-flexible-server')).toBe('Data');
    expect(azureFindingToAssetClass('azure-nsg')).toBe('Network');
    expect(azureFindingToAssetClass('azure-key-vault')).toBe('Security-Global');
    expect(azureFindingToAssetClass('azure-role-definition')).toBe('Security-Global');
    expect(azureFindingToAssetClass('azure-subscription')).toBe('Security-Global');
    expect(azureFindingToAssetClass('azure-environment-separation')).toBe('Security-Global');
  });

  it('routes future compute/network/data types by family', () => {
    expect(azureFindingToAssetClass('azure-virtual-machine')).toBe('Compute');
    expect(azureFindingToAssetClass('azure-kubernetes-service')).toBe('Compute');
    expect(azureFindingToAssetClass('azure-virtual-network')).toBe('Network');
    expect(azureFindingToAssetClass('azure-cosmosdb-account')).toBe('Data');
    expect(azureFindingToAssetClass('azure-entra-user')).toBe('Security-Global');
  });

  it('fails closed to Security-Global on unknown or non-string input', () => {
    expect(azureFindingToAssetClass('azure-something-new')).toBe('Security-Global');
    expect(azureFindingToAssetClass('')).toBe('Security-Global');
    expect(azureFindingToAssetClass(undefined)).toBe('Security-Global');
    expect(azureFindingToAssetClass(null)).toBe('Security-Global');
    expect(azureFindingToAssetClass(42)).toBe('Security-Global');
  });
});

describe('azureRemediatorSpName', () => {
  it('mints a lowercase hyphenated display name per class', () => {
    expect(azureRemediatorSpName({ assetClass: 'Storage' })).toBe('opencomp-remediator-storage');
    expect(azureRemediatorSpName({ assetClass: 'Security-Global' })).toBe(
      'opencomp-remediator-security-global',
    );
  });
});

describe('azure remediation keys', () => {
  it('mints Class:subscription keys for valid subscription ids', () => {
    expect(azureRemediationKey({ assetClass: 'Storage', subscriptionId: SUB })).toBe(
      `Storage:${SUB}`,
    );
  });

  it('throws on non-GUID subscription ids instead of minting a bad key', () => {
    expect(() => azureRemediationKey({ assetClass: 'Storage', subscriptionId: 'nope' })).toThrow(
      /valid Azure subscription id/,
    );
    expect(() => azureRemediationKey({ assetClass: 'Storage', subscriptionId: '' })).toThrow(
      /valid Azure subscription id/,
    );
  });

  it('normalizes whitespace and validates both halves', () => {
    expect(normalizeAzureRemediationKey(`Storage: ${SUB} `)).toBe(`Storage:${SUB}`);
    expect(normalizeAzureRemediationKey(` Storage:${SUB}`)).toBe(`Storage:${SUB}`);
    expect(normalizeAzureRemediationKey('Bogus:class')).toBeUndefined();
    expect(normalizeAzureRemediationKey('Storage:not-a-guid')).toBeUndefined();
    expect(normalizeAzureRemediationKey('Storage')).toBeUndefined();
    expect(normalizeAzureRemediationKey(':')).toBeUndefined();
    expect(isAzureRemediationKey(`Data:${SUB}`)).toBe(true);
    expect(isAzureRemediationKey('Data:nope')).toBe(false);
  });
});

describe('parseAzureRemediationMap', () => {
  it('keeps valid Class:subscription -> SP app-id pairs', () => {
    expect(parseAzureRemediationMap(JSON.stringify({ [`Storage:${SUB}`]: APP_ID }))).toEqual({
      [`Storage:${SUB}`]: APP_ID.toLowerCase(),
    });
  });

  it('fails closed to {} on garbage input', () => {
    expect(parseAzureRemediationMap(undefined)).toEqual({});
    expect(parseAzureRemediationMap('')).toEqual({});
    expect(parseAzureRemediationMap('   ')).toEqual({});
    expect(parseAzureRemediationMap('not-json')).toEqual({});
    expect(parseAzureRemediationMap([])).toEqual({});
    expect(parseAzureRemediationMap(42)).toEqual({});
  });

  it('drops entries with bad keys or non-GUID app ids', () => {
    expect(
      parseAzureRemediationMap({
        [`Storage:${SUB}`]: APP_ID,
        'Bogus:x': APP_ID,
        [`Data:${SUB}`]: 'not-a-guid',
        [`Network:${SUB}`]: '',
      }),
    ).toEqual({ [`Storage:${SUB}`]: APP_ID.toLowerCase() });
  });

  it('serializes by dropping invalid entries', () => {
    expect(
      serializeAzureRemediationMap({
        [`Storage:${SUB}`]: APP_ID,
        [`Data:${SUB}`]: 'junk',
      }),
    ).toBe(JSON.stringify({ [`Storage:${SUB}`]: APP_ID.toLowerCase() }));
  });
});

describe('parseAzureRemediationKey', () => {
  it('splits canonical keys without casting', () => {
    expect(parseAzureRemediationKey(`Storage:${SUB}`)).toEqual({
      assetClass: 'Storage',
      subscriptionId: SUB,
    });
    expect(parseAzureRemediationKey('Storage:nope')).toBeUndefined();
    expect(parseAzureRemediationKey('Bogus:class')).toBeUndefined();
    expect(parseAzureRemediationKey('Storage')).toBeUndefined();
  });
});

describe('parseAzureRemediationSecrets', () => {
  it('keeps non-empty secrets under valid keys (no format assumed)', () => {
    expect(
      parseAzureRemediationSecrets(JSON.stringify({ [`Storage:${SUB}`]: 's3cr3t-value' })),
    ).toEqual({ [`Storage:${SUB}`]: 's3cr3t-value' });
  });

  it('fails closed to {} on garbage input', () => {
    expect(parseAzureRemediationSecrets(undefined)).toEqual({});
    expect(parseAzureRemediationSecrets('')).toEqual({});
    expect(parseAzureRemediationSecrets('not-json')).toEqual({});
    expect(parseAzureRemediationSecrets([])).toEqual({});
    expect(
      parseAzureRemediationSecrets({
        [`Storage:${SUB}`]: 's3cr3t',
        'Bogus:x': 's3cr3t',
        [`Data:${SUB}`]: '',
        [`Network:${SUB}`]: 42,
      }),
    ).toEqual({ [`Storage:${SUB}`]: 's3cr3t' });
  });
});

describe('getAzureRemediationMapParseError', () => {
  it('accepts absent, blank, empty, and valid maps', () => {
    expect(getAzureRemediationMapParseError(undefined)).toBeNull();
    expect(getAzureRemediationMapParseError(null)).toBeNull();
    expect(getAzureRemediationMapParseError('')).toBeNull();
    expect(getAzureRemediationMapParseError('{}')).toBeNull();
    expect(
      getAzureRemediationMapParseError(JSON.stringify({ [`Storage:${SUB}`]: APP_ID })),
    ).toBeNull();
  });

  it('rejects non-object JSON and non-string values', () => {
    expect(getAzureRemediationMapParseError('[1]')).toMatch(/JSON object/);
    expect(getAzureRemediationMapParseError('42')).toMatch(/JSON object/);
    expect(getAzureRemediationMapParseError({ [`Storage:${SUB}`]: 42 })).toMatch(
      /application \(client\) ID/,
    );
  });

  it('rejects bad keys and duplicate-after-trim keys', () => {
    expect(getAzureRemediationMapParseError({ 'Storage:nope': APP_ID })).toMatch(/keys must be/);
    expect(
      getAzureRemediationMapParseError({
        [`Storage:${SUB}`]: APP_ID,
        [`Storage: ${SUB} `]: APP_ID,
      }),
    ).toMatch(/duplicate key/);
  });

  it('caps the binding count so one request cannot fan out probes', () => {
    const oversized: Record<string, string> = {};
    for (let i = 0; i < MAX_AZURE_REMEDIATION_PAIRS + 1; i += 1) {
      const sub = `12345678-1234-1234-1234-${String(i).padStart(12, '0')}`;
      oversized[`Storage:${sub}`] = APP_ID;
    }
    expect(getAzureRemediationMapParseError(oversized)).toMatch(/too many bindings/);
  });
});
