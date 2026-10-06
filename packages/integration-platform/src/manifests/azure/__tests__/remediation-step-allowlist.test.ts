import { describe, expect, it } from 'vitest';
import {
  AZURE_FIX_FORWARD_ALLOWLIST,
  azureRollbackDeletePrefixAllowed,
  isAzureAllowlistedFixStep,
  normalizeAzureUrlForAllowlist,
} from '../remediation-allowlist';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const STORAGE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`;
const VM_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Compute/virtualMachines/vm?api-version=2024-01-01`;

describe('normalizeAzureUrlForAllowlist', () => {
  it('strips scope, query, and lowercases', () => {
    expect(normalizeAzureUrlForAllowlist(STORAGE_URL)).toBe(
      'https://management.azure.com/providers/microsoft.storage/storageaccounts/sa',
    );
  });

  it('refuses non-HTTPS and non-management hosts', () => {
    expect(normalizeAzureUrlForAllowlist(STORAGE_URL.replace('https:', 'http:'))).toBeUndefined();
    expect(
      normalizeAzureUrlForAllowlist(
        STORAGE_URL.replace('management.azure.com', 'evil.example.com'),
      ),
    ).toBeUndefined();
    expect(
      normalizeAzureUrlForAllowlist('https://graph.microsoft.com/v1.0/users/x'),
    ).toBeUndefined();
  });

  it('decodes until stable and fails closed on leftovers', () => {
    const encoded = STORAGE_URL.replace('storageAccounts', '%73torageAccounts');
    expect(normalizeAzureUrlForAllowlist(encoded)).toBe(
      'https://management.azure.com/providers/microsoft.storage/storageaccounts/sa',
    );
    const doubleEncoded = STORAGE_URL.replace('storageAccounts', '%2573torageAccounts');
    expect(normalizeAzureUrlForAllowlist(doubleEncoded)).toBe(
      'https://management.azure.com/providers/microsoft.storage/storageaccounts/sa',
    );
    expect(
      normalizeAzureUrlForAllowlist(STORAGE_URL.replace('storageAccounts', 'storageAccounts%zz')),
    ).toBeUndefined();
  });

  it('resolves dot-segments and refuses encoded traversal above root', () => {
    const dotted = STORAGE_URL.replace(
      '/providers/Microsoft.Storage/',
      '/x/../providers/Microsoft.Storage/./',
    );
    expect(normalizeAzureUrlForAllowlist(dotted)).toBe(
      'https://management.azure.com/providers/microsoft.storage/storageaccounts/sa',
    );
    // Raw `..` collapses in the URL parser to a malformed scope head
    // (`/subscriptions/other`), which fails closed here.
    expect(
      normalizeAzureUrlForAllowlist(
        'https://management.azure.com/subscriptions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/../other',
      ),
    ).toBeUndefined();
    // Single-encoded dots collapse in the URL parser to a scope-less
    // path, which no prefix matches (refused at match time, not here).
    expect(
      normalizeAzureUrlForAllowlist(
        'https://management.azure.com/%2e%2e/%2e%2e/x?api-version=2023-05-01',
      ),
    ).toBe('https://management.azure.com/x');
    // Double-encoded traversal survives the parser and reaches the manual
    // resolver, which fails closed on popping past the root.
    expect(
      normalizeAzureUrlForAllowlist(
        'https://management.azure.com/%252e%252e/%252e%252e/x?api-version=2023-05-01',
      ),
    ).toBeUndefined();
  });

  it('keeps bare resource-group paths for the resourcegroups prefix', () => {
    expect(
      normalizeAzureUrlForAllowlist(
        `https://management.azure.com/subscriptions/${SUB}/resourcegroups/rg?api-version=2021-04-01`,
      ),
    ).toBe('https://management.azure.com/resourcegroups/rg');
    expect(
      isAzureAllowlistedFixStep({
        assetClass: 'Security-Global',
        method: 'PUT',
        url: `https://management.azure.com/subscriptions/${SUB}/resourcegroups/rg?api-version=2021-04-01`,
      }),
    ).toBe(true);
  });

  it('refuses unparseable and scope-less URLs', () => {
    expect(normalizeAzureUrlForAllowlist('not a url')).toBeUndefined();
    expect(normalizeAzureUrlForAllowlist('')).toBeUndefined();
    expect(
      normalizeAzureUrlForAllowlist(`https://management.azure.com/subscriptions/${SUB}`),
    ).toBeUndefined();
  });
});

describe('isAzureAllowlistedFixStep', () => {
  it('allows Storage PATCH on storage accounts', () => {
    expect(
      isAzureAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: STORAGE_URL,
      }),
    ).toBe(true);
  });

  it('allows Compute PUT on VMs and sub-resource writes by prefix', () => {
    expect(
      isAzureAllowlistedFixStep({
        assetClass: 'Compute',
        method: 'PUT',
        url: VM_URL,
      }),
    ).toBe(true);
    // Sub-resources inherit the prefix: extensions of an allowlisted VM.
    expect(
      isAzureAllowlistedFixStep({
        assetClass: 'Compute',
        method: 'PUT',
        url: `${VM_URL.split('?')[0]}/extensions/customScript?api-version=2024-01-01`,
      }),
    ).toBe(true);
    // Segment-boundary match only: a collection name sharing the
    // string prefix but not the segment is refused.
    expect(
      isAzureAllowlistedFixStep({
        assetClass: 'Compute',
        method: 'PUT',
        url: VM_URL.replace('virtualMachines/vm', 'virtualMachinesEvil/vm'),
      }),
    ).toBe(false);
  });

  it('refuses cross-class, wrong-method, and POST action calls', () => {
    expect(
      isAzureAllowlistedFixStep({
        assetClass: 'Compute',
        method: 'PATCH',
        url: STORAGE_URL,
      }),
    ).toBe(false);
    expect(
      isAzureAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'GET',
        url: STORAGE_URL,
      }),
    ).toBe(false);
    expect(
      isAzureAllowlistedFixStep({
        assetClass: 'Compute',
        method: 'POST',
        url: `${VM_URL.split('?')[0]}/start?api-version=2024-01-01`,
      }),
    ).toBe(false);
  });

  it('refuses Key Vault writes for every auto-fix class', () => {
    const vaultUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.KeyVault/vaults/v?api-version=2023-07-01`;
    for (const assetClass of ['Storage', 'Compute', 'Data'] as const) {
      expect(isAzureAllowlistedFixStep({ assetClass, method: 'PATCH', url: vaultUrl })).toBe(false);
    }
  });

  it('every class has entries and no entry uses a wildcard', () => {
    for (const [assetClass, entries] of Object.entries(AZURE_FIX_FORWARD_ALLOWLIST)) {
      expect(entries.length, assetClass).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.urlPrefix).not.toContain('*');
        expect(entry.urlPrefix.startsWith('https://')).toBe(true);
      }
    }
  });
});

describe('azureRollbackDeletePrefixAllowed', () => {
  it('allows DELETE inside the class surface regardless of method', () => {
    expect(
      azureRollbackDeletePrefixAllowed({
        assetClass: 'Storage',
        url: STORAGE_URL,
      }),
    ).toBe(true);
  });

  it('refuses DELETE outside the class surface', () => {
    expect(
      azureRollbackDeletePrefixAllowed({
        assetClass: 'Storage',
        url: VM_URL,
      }),
    ).toBe(false);
  });
});
