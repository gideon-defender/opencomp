import {
  resolveAzureExecutionIdentity,
  resolveAzureRemediationIdentity,
} from './azure-remediation-role-resolver';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const APP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function credentialsWith(map: Record<string, string>) {
  return { azureRemediation: JSON.stringify(map) };
}

describe('resolveAzureExecutionIdentity', () => {
  const SECRETS = JSON.stringify({ [`Storage:${SUB}`]: 'secret-1' });

  function boundStorage(extra?: Record<string, unknown>) {
    return {
      azureRemediation: JSON.stringify({ [`Storage:${SUB}`]: APP_ID }),
      azureRemediationSecrets: SECRETS,
      ...extra,
    };
  }

  it('returns the SP identity for a bound, non-gated pair', () => {
    expect(
      resolveAzureExecutionIdentity({
        credentials: boundStorage(),
        resourceType: 'azure-storage-account',
        subscriptionId: SUB,
      }),
    ).toEqual({
      spAppId: APP_ID.toLowerCase(),
      secret: 'secret-1',
      assetClass: 'Storage',
      subscriptionId: SUB,
      expectedKey: `Storage:${SUB}`,
    });
  });

  it('throws guided-only when the pair is unbound (never falls back to the user token)', () => {
    expect(() =>
      resolveAzureExecutionIdentity({
        credentials: {},
        resourceType: 'azure-sql-server',
        subscriptionId: SUB,
      }),
    ).toThrow(/No remediator SP bound for Data:/);
  });

  it('throws human-approval for gated classes even when bound', () => {
    expect(() =>
      resolveAzureExecutionIdentity({
        credentials: {
          azureRemediation: JSON.stringify({ [`Network:${SUB}`]: APP_ID }),
          azureRemediationSecrets: JSON.stringify({
            [`Network:${SUB}`]: 'secret-1',
          }),
        },
        resourceType: 'azure-nsg',
        subscriptionId: SUB,
      }),
    ).toThrow(/require human approval/);
  });

  it('throws when the bound pair has no stored secret', () => {
    expect(() =>
      resolveAzureExecutionIdentity({
        credentials: {
          azureRemediation: JSON.stringify({ [`Storage:${SUB}`]: APP_ID }),
        },
        resourceType: 'azure-storage-account',
        subscriptionId: SUB,
      }),
    ).toThrow(/no stored client secret/);
  });
});

describe('resolveAzureRemediationIdentity', () => {
  it('resolves the bound SP for the finding pair', () => {
    expect(
      resolveAzureRemediationIdentity({
        credentials: credentialsWith({ [`Storage:${SUB}`]: APP_ID }),
        resourceType: 'azure-storage-account',
        subscriptionId: SUB,
      }),
    ).toEqual({
      spAppId: APP_ID.toLowerCase(),
      assetClass: 'Storage',
      approvalGated: false,
      expectedKey: `Storage:${SUB}`,
    });
  });

  it('leaves the SP unresolved (fail closed) when the pair is unbound', () => {
    const resolved = resolveAzureRemediationIdentity({
      credentials: credentialsWith({}),
      resourceType: 'azure-sql-server',
      subscriptionId: SUB,
    });
    expect(resolved.spAppId).toBeUndefined();
    expect(resolved.assetClass).toBe('Data');
    expect(resolved.approvalGated).toBe(false);
    expect(resolved.expectedKey).toBe(`Data:${SUB}`);
  });

  it('marks approval-gated classes even when bound', () => {
    const resolved = resolveAzureRemediationIdentity({
      credentials: credentialsWith({ [`Network:${SUB}`]: APP_ID }),
      resourceType: 'azure-nsg',
      subscriptionId: SUB,
    });
    expect(resolved.spAppId).toBe(APP_ID.toLowerCase());
    expect(resolved.assetClass).toBe('Network');
    expect(resolved.approvalGated).toBe(true);
  });

  it('degrades to a display-only key on garbage subscription ids (never throws)', () => {
    const resolved = resolveAzureRemediationIdentity({
      credentials: credentialsWith({ [`Storage:${SUB}`]: APP_ID }),
      resourceType: 'azure-storage-account',
      subscriptionId: 'not-a-guid',
    });
    expect(resolved.spAppId).toBeUndefined();
    expect(resolved.expectedKey).toBe('Storage:not-a-guid');
  });

  it('routes coarse subscription findings to the human-gated class', () => {
    const resolved = resolveAzureRemediationIdentity({
      credentials: credentialsWith({}),
      resourceType: 'azure-subscription',
      subscriptionId: SUB,
    });
    expect(resolved.assetClass).toBe('Security-Global');
    expect(resolved.approvalGated).toBe(true);
  });

  it('reads only string-form maps (vault shape) and degrades otherwise', () => {
    // Non-string input is ignored — the vault stores the map as a JSON
    // string, so anything else degrades to unbound, never throws.
    const nonString = resolveAzureRemediationIdentity({
      credentials: { azureRemediation: { [`Storage:${SUB}`]: APP_ID } },
      resourceType: 'azure-storage-account',
      subscriptionId: SUB,
    });
    expect(nonString.spAppId).toBeUndefined();
    expect(nonString.expectedKey).toBe(`Storage:${SUB}`);
    const missing = resolveAzureRemediationIdentity({
      credentials: {},
      resourceType: 'azure-storage-account',
      subscriptionId: SUB,
    });
    expect(missing.spAppId).toBeUndefined();
  });
});
