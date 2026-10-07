import { validateAzureWriteStepParams } from './azure-remediation-param-guardrails';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const COSMOS_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.DocumentDB/databaseAccounts/acct?api-version=2024-02-15-preview`;

function check(step: {
  method: string;
  url: string;
  body?: unknown;
}): string[] {
  return validateAzureWriteStepParams(step, { index: 2 });
}

describe('validateDocumentDbAccount via validateAzureWriteStepParams', () => {
  it('refuses public network access without caller restriction', () => {
    // The Data-class allowlist admits Cosmos writes, but no value guard
    // watched them — an Enabled account auto-executed with zero findings.
    expect(
      check({
        method: 'PATCH',
        url: COSMOS_URL,
        body: { properties: { publicNetworkAccess: 'Enabled' } },
      }).join(' '),
    ).toContain('without IP or VNet restriction');
  });

  it('allows the lockdown fix and scoped restrictions', () => {
    // The prompt's canonical fix disables public access.
    expect(
      check({
        method: 'PATCH',
        url: COSMOS_URL,
        body: { properties: { publicNetworkAccess: 'Disabled' } },
      }),
    ).toEqual([]);
    // Enabled with a scoped office range restricts callers: allowed.
    expect(
      check({
        method: 'PATCH',
        url: COSMOS_URL,
        body: {
          properties: {
            publicNetworkAccess: 'Enabled',
            ipRules: [{ ipAddressOrRange: '10.0.0.1' }],
          },
        },
      }),
    ).toEqual([]);
    // Enabled behind a VNet filter restricts callers: allowed.
    expect(
      check({
        method: 'PATCH',
        url: COSMOS_URL,
        body: {
          properties: {
            publicNetworkAccess: 'Enabled',
            isVirtualNetworkFilterEnabled: true,
          },
        },
      }),
    ).toEqual([]);
  });

  it('refuses internet-open Cosmos ipRules', () => {
    expect(
      check({
        method: 'PATCH',
        url: COSMOS_URL,
        body: {
          properties: {
            publicNetworkAccess: 'Enabled',
            ipRules: [
              { ipAddressOrRange: '10.0.0.1' },
              { ipAddressOrRange: '0.0.0.0/0' },
            ],
          },
        },
      }).join(' '),
    ).toContain('opens the data plane');
  });

  it('ignores storage-shaped ipRule keys on Cosmos bodies', () => {
    // Cosmos rules carry `ipAddressOrRange`, not storage's `value`: a
    // storage-shaped entry restricts nothing, so Enabled still refuses.
    expect(
      check({
        method: 'PATCH',
        url: COSMOS_URL,
        body: {
          properties: {
            publicNetworkAccess: 'Enabled',
            ipRules: [{ value: '10.0.0.1' }],
          },
        },
      }).join(' '),
    ).toContain('without IP or VNet restriction');
  });
});
