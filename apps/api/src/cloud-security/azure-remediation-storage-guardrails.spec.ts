import { validateAzureWriteStepParams } from './azure-remediation-param-guardrails';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const STORAGE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`;
const CONTAINER_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Storage/storageAccounts/sa/blobServices/default/containers/data?api-version=2023-05-01`;

function check(step: {
  method: string;
  url: string;
  body?: unknown;
}): string[] {
  return validateAzureWriteStepParams(step, { index: 2 });
}

describe('validateStoragePatch via validateAzureWriteStepParams', () => {
  it('refuses storage values that widen access', () => {
    expect(
      check({
        method: 'PATCH',
        url: STORAGE_URL,
        body: { properties: { allowBlobPublicAccess: true } },
      }).join(' '),
    ).toContain('"allowBlobPublicAccess": true');
    expect(
      check({
        method: 'PATCH',
        url: STORAGE_URL,
        body: { properties: { supportsHttpsTrafficOnly: false } },
      }).join(' '),
    ).toContain('downgrades transport');
    expect(
      check({
        method: 'PATCH',
        url: STORAGE_URL,
        body: { properties: { minimumTlsVersion: 'TLS1_0' } },
      }).join(' '),
    ).toContain('weakens encryption');
    expect(
      check({
        method: 'PATCH',
        url: STORAGE_URL,
        body: {
          properties: {
            allowBlobPublicAccess: false,
            minimumTlsVersion: 'TLS1_2',
          },
        },
      }),
    ).toEqual([]);
    expect(
      check({
        method: 'PATCH',
        url: STORAGE_URL,
        body: { properties: { networkAcls: { defaultAction: 'Allow' } } },
      }).join(' '),
    ).toContain('opens the data plane');
    expect(
      check({
        method: 'PATCH',
        url: STORAGE_URL,
        body: { properties: { publicNetworkAccess: 'Enabled' } },
      }).join(' '),
    ).toContain('opens the data plane');
  });

  it('refuses container writes that open anonymous access', () => {
    // The allowlist admits any depth under storageAccounts, so a
    // container PUT sails past the account-level guard — this check
    // closes the depth.
    expect(
      check({
        method: 'PUT',
        url: CONTAINER_URL,
        body: { properties: { publicAccess: 'Container' } },
      }).join(' '),
    ).toContain('opens anonymous access');
    expect(
      check({
        method: 'PUT',
        url: CONTAINER_URL,
        body: { properties: { publicAccess: 'Blob' } },
      }).join(' '),
    ).toContain('opens anonymous access');
  });

  it('allows locked-down and access-free container writes', () => {
    expect(
      check({
        method: 'PUT',
        url: CONTAINER_URL,
        body: { properties: { publicAccess: 'None' } },
      }),
    ).toEqual([]);
    // No access field changes nothing about exposure.
    expect(
      check({
        method: 'PUT',
        url: CONTAINER_URL,
        body: { properties: { metadata: { owner: 'data-team' } } },
      }),
    ).toEqual([]);
  });
});
