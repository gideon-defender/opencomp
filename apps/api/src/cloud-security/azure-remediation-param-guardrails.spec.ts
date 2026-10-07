import {
  validateAzureWriteStepParams,
  validateFirewallScope,
} from './azure-remediation-param-guardrails';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const NSG_RULE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Network/networkSecurityGroups/nsg/securityRules/allow-ssh?api-version=2023-11-01`;
const STORAGE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01`;
const DIAG_URL =
  `https://management.azure.com/subscriptions/${SUB}` +
  `/providers/Microsoft.Insights/diagnosticSettings/s?api-version=2021-05-01-preview`;
const FW_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/other` +
  `/providers/Microsoft.Network/azureFirewalls/fw?api-version=2023-11-01`;

function check(
  step: { method: string; url: string; body?: unknown },
  scope?: { subscriptionId: string; resourceGroup?: string },
): string[] {
  return validateAzureWriteStepParams(step, {
    index: 2,
    ...(scope ? { findingScope: scope } : {}),
  });
}

describe('validateAzureWriteStepParams', () => {
  it('skips reads and deletes', () => {
    expect(check({ method: 'GET', url: NSG_RULE_URL })).toEqual([]);
    expect(check({ method: 'DELETE', url: NSG_RULE_URL })).toEqual([]);
  });

  it('refuses unparseable URLs instead of passing silently', () => {
    expect(check({ method: 'PATCH', url: 'garbage' }).join(' ')).toMatch(
      /not an Azure management-plane call/,
    );
  });

  it('refuses diagnostic settings that drop log categories', () => {
    const findings = check({
      method: 'PUT',
      url: DIAG_URL,
      body: {
        properties: {
          logs: [
            { category: 'Administrative', enabled: true },
            { category: 'Security', enabled: false },
          ],
        },
      },
    });
    expect(findings).toHaveLength(2);
    expect(findings.join(' ')).toContain('"Security"');
    // PUT with logs but no Security category drops it just as surely as
    // an explicit disable — PUT replaces the whole document.
    expect(
      check({
        method: 'PUT',
        url: DIAG_URL,
        body: {
          properties: { logs: [{ category: 'AuditLogs', enabled: true }] },
        },
      }).join(' '),
    ).toContain('without an enabled Security log category');
    // PATCH merges, so omitting a category is safe there.
    expect(
      check({
        method: 'PATCH',
        url: DIAG_URL,
        body: {
          properties: { logs: [{ category: 'AuditLogs', enabled: true }] },
        },
      }),
    ).toEqual([]);
    // PUT replaces the whole document: missing or empty logs silently
    // drops every category, so both fail closed.
    expect(
      check({
        method: 'PUT',
        url: DIAG_URL,
        body: { properties: { workspaceId: 'ws' } },
      }).join(' '),
    ).toContain('without "logs"');
    expect(
      check({
        method: 'PUT',
        url: DIAG_URL,
        body: { properties: { logs: [] } },
      }).join(' '),
    ).toContain('empty "logs"');
    expect(
      check({
        method: 'PUT',
        url: DIAG_URL,
        body: {
          properties: { logs: [{ category: 'Security', enabled: true }] },
        },
      }),
    ).toEqual([]);
  });

  it('refuses firewall rules outside the finding resource group', () => {
    expect(
      check(
        { method: 'PUT', url: FW_URL, body: { properties: {} } },
        { subscriptionId: SUB, resourceGroup: 'rg' },
      ).join(' '),
    ).toContain('outside the finding');
    expect(
      check(
        { method: 'PUT', url: FW_URL, body: { properties: {} } },
        { subscriptionId: SUB, resourceGroup: 'other' },
      ),
    ).toEqual([]);
    expect(
      check({ method: 'PUT', url: FW_URL, body: { properties: {} } }),
    ).toEqual([]);
    // Percent-encoded scope keys resolve on the wire: the pin must too.
    const encodedRgUrl = FW_URL.replace('resourceGroups', '%72esourceGroups');
    expect(
      check(
        { method: 'PUT', url: encodedRgUrl, body: { properties: {} } },
        { subscriptionId: SUB, resourceGroup: 'rg' },
      ).join(' '),
    ).toContain('outside the finding');
  });

  it('fails closed on undecodable and group-less firewall URLs', () => {
    // A group-less URL under a grouped finding proves nothing either.
    const grouplessUrl =
      `https://management.azure.com/subscriptions/${SUB}` +
      `/providers/Microsoft.Network/azureFirewalls/fw?api-version=2023-11-01`;
    expect(
      check(
        { method: 'PUT', url: grouplessUrl, body: { properties: {} } },
        { subscriptionId: SUB, resourceGroup: 'rg' },
      ).join(' '),
    ).toContain('no resource group');
    // An undecodable scope key resolves on the wire: silence would read
    // as approval for a scope the guard never saw. The dispatcher
    // rejects undecodable URLs before the scope pin runs, so this
    // exercises the pin directly.
    const undecodableUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/%ZZ` +
      `/providers/Microsoft.Network/azureFirewalls/fw?api-version=2023-11-01`;
    expect(
      validateFirewallScope(
        undecodableUrl,
        { subscriptionId: SUB, resourceGroup: 'rg' },
        'Step 2',
      ).join(' '),
    ).toContain('undecodable');
    expect(
      validateFirewallScope(
        'garbage',
        { subscriptionId: SUB, resourceGroup: 'rg' },
        'Step 2',
      ).join(' '),
    ).toContain('undecodable');
  });

  it('refuses open ipRule exceptions under defaultAction Deny', () => {
    // A Deny default with an internet-open exception still opens the
    // data plane: each ipRule is a firewall allow-entry of its own.
    expect(
      check({
        method: 'PATCH',
        url: STORAGE_URL,
        body: {
          properties: {
            networkAcls: {
              defaultAction: 'Deny',
              ipRules: [{ value: '10.0.0.1' }, { value: '0.0.0.0/0' }],
            },
          },
        },
      }).join(' '),
    ).toContain('ipRule "0.0.0.0/0"');
    expect(
      check({
        method: 'PATCH',
        url: STORAGE_URL,
        body: {
          properties: {
            networkAcls: {
              defaultAction: 'Deny',
              ipRules: [{ value: '10.0.0.1' }],
            },
          },
        },
      }),
    ).toEqual([]);
    // Vault ACLs get the same exception check.
    const vaultUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.KeyVault/vaults/v?api-version=2023-07-01`;
    expect(
      check({
        method: 'PATCH',
        url: vaultUrl,
        body: {
          properties: {
            networkAcls: {
              defaultAction: 'Deny',
              ipRules: [{ value: '0.0.0.0/0' }],
            },
          },
        },
      }).join(' '),
    ).toContain('ipRule "0.0.0.0/0"');
    // IPv6 internet-open exceptions trip the same guards.
    expect(
      check({
        method: 'PATCH',
        url: STORAGE_URL,
        body: {
          properties: {
            networkAcls: {
              defaultAction: 'Deny',
              ipRules: [{ value: '::/0' }],
            },
          },
        },
      }).join(' '),
    ).toContain('ipRule "::/0"');
    expect(
      check({
        method: 'PATCH',
        url: vaultUrl,
        body: {
          properties: {
            networkAcls: {
              defaultAction: 'Deny',
              ipRules: [{ value: '::/0' }],
            },
          },
        },
      }).join(' '),
    ).toContain('ipRule "::/0"');
  });

  it('refuses provider registration POSTs and vault ACL opens', () => {
    expect(
      check({
        method: 'POST',
        url:
          `https://management.azure.com/subscriptions/${SUB}` +
          `/providers/Microsoft.Storage/register?api-version=2021-04-01`,
      }).join(' '),
    ).toContain('executor-internal');
    const vaultUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.KeyVault/vaults/v?api-version=2023-07-01`;
    expect(
      check({
        method: 'PATCH',
        url: vaultUrl,
        body: { properties: { networkAcls: { defaultAction: 'Allow' } } },
      }).join(' '),
    ).toContain('opens the data plane');
  });

  it('runs value guards on rollback bodies too', () => {
    // Rollback bodies are model-generated, never proven replays: an open
    // value in a rollback step fails exactly like the same fix value.
    expect(
      validateAzureWriteStepParams(
        {
          method: 'PATCH',
          url: STORAGE_URL,
          body: { properties: { allowBlobPublicAccess: true } },
        },
        { index: 0, isRollback: true },
      ).join(' '),
    ).toContain('"allowBlobPublicAccess": true');
    expect(
      validateAzureWriteStepParams(
        {
          method: 'PUT',
          url: NSG_RULE_URL,
          body: {
            properties: {
              access: 'Allow',
              sourceAddressPrefix: '*',
              destinationPortRange: '*',
            },
          },
        },
        { index: 0, isRollback: true },
      ).join(' '),
    ).toContain('on every port');
  });
});
