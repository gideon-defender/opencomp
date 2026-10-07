import { describe, expect, it } from 'vitest';
import {
  AZURE_REMEDIATION_DETECTION_ACTION_GROUP_NAME,
  azureActionGroupId,
  azureDetectionRuleName,
  getAzureRemediationDetectionScript,
  type AzureRemediationDetectionService,
} from '../remediation-detection-script';
import type { AzureRemediationAssetClass } from '../remediation-roles';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const SP_STORAGE = '11111111-1111-1111-1111-111111111111';
const SP_DATA = '22222222-2222-2222-2222-222222222222';

const storageService: AzureRemediationDetectionService = {
  assetClass: 'Storage',
  appId: SP_STORAGE,
};

const BASE_OPTIONS = {
  subscriptionId: SUB,
  resourceGroup: 'rg-opencomp',
  services: [storageService],
  email: 'security@example.com',
};

describe('azureDetectionRuleName', () => {
  it('names write and denied rules per class', () => {
    expect(
      azureDetectionRuleName({ rule: 'OpenComp-RemediatorWrite', assetClass: 'Storage' }),
    ).toBe('OpenComp-RemediatorWrite-Storage');
    expect(azureDetectionRuleName({ rule: 'OpenComp-RemediatorDenied', assetClass: 'Data' })).toBe(
      'OpenComp-RemediatorDenied-Data',
    );
  });

  it('names approval-gated rules per class and surface within limits', () => {
    const name = azureDetectionRuleName({
      rule: 'OpenComp-RemediatorApprovalGated',
      assetClass: 'Security-Global',
      surfaceCode: 'RoleDef',
    });
    expect(name).toBe('OpenComp-RemediatorApprovalGated-Security-Global-RoleDef');
    expect(name.length).toBeLessThanOrEqual(60);
  });

  it('requires a surface code for approval-gated rules', () => {
    expect(() =>
      azureDetectionRuleName({ rule: 'OpenComp-RemediatorApprovalGated', assetClass: 'Storage' }),
    ).toThrow(/surfaceCode/);
  });
});

describe('azureActionGroupId', () => {
  it('builds the fully qualified action-group ID', () => {
    expect(
      azureActionGroupId({ subscriptionId: SUB, resourceGroup: 'rg', actionGroupName: 'Ag' }),
    ).toBe(`/subscriptions/${SUB}/resourceGroups/rg/providers/microsoft.insights/actionGroups/Ag`);
  });
});

describe('getAzureRemediationDetectionScript', () => {
  it('wires the action group and one alert per signal', () => {
    const script = getAzureRemediationDetectionScript({ ...BASE_OPTIONS });
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain(AZURE_REMEDIATION_DETECTION_ACTION_GROUP_NAME);
    expect(script).toContain('security@example.com');
    // Write + denied + three gated surfaces for one SP.
    expect(script).toContain('OpenComp-RemediatorWrite-Storage');
    expect(script).toContain('OpenComp-RemediatorDenied-Storage');
    expect(script).toContain('OpenComp-RemediatorApprovalGated-Storage-RoleAssign');
    expect(script).toContain('OpenComp-RemediatorApprovalGated-Storage-RoleDef');
    expect(script).toContain('OpenComp-RemediatorApprovalGated-Storage-KeyVault');
    // Conditions match the filter builders (alerts cannot drift from queries).
    expect(script).toContain(
      `caller=${SP_STORAGE} and category=Administrative and status=Succeeded`,
    );
    expect(script).toContain(`caller=${SP_STORAGE} and status=Failed`);
    expect(script).toContain('resourceType=Microsoft.Authorization/roleAssignments');
    // Rerun-safe: delete-then-create per rule.
    expect(script).toContain('activity-log alert delete');
  });

  it('emits per-class rules for every bound SP', () => {
    const script = getAzureRemediationDetectionScript({
      ...BASE_OPTIONS,
      services: [
        { assetClass: 'Storage', appId: SP_STORAGE },
        { assetClass: 'Data', appId: SP_DATA },
      ],
    });
    expect(script).toContain('OpenComp-RemediatorWrite-Storage');
    expect(script).toContain('OpenComp-RemediatorWrite-Data');
    expect(script).toContain(`caller=${SP_DATA} and category=Administrative and status=Succeeded`);
  });

  it('rejects bad subscription, resource group, email-unsafe, and binding input', () => {
    expect(() =>
      getAzureRemediationDetectionScript({ ...BASE_OPTIONS, subscriptionId: 'nope' }),
    ).toThrow(/subscription id/);
    expect(() =>
      getAzureRemediationDetectionScript({ ...BASE_OPTIONS, resourceGroup: 'rg evil' }),
    ).toThrow(/resource group/);
    expect(() => getAzureRemediationDetectionScript({ ...BASE_OPTIONS, services: [] })).toThrow(
      /at least one/,
    );
    expect(() =>
      getAzureRemediationDetectionScript({
        ...BASE_OPTIONS,
        services: [{ assetClass: 'Storage', appId: 'nope' }],
      }),
    ).toThrow(/application \(client\) ID/);
    expect(() =>
      getAzureRemediationDetectionScript({
        ...BASE_OPTIONS,
        services: [
          { assetClass: 'Storage', appId: SP_STORAGE },
          { assetClass: 'Storage', appId: SP_DATA },
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      getAzureRemediationDetectionScript({
        ...BASE_OPTIONS,
        services: [
          { assetClass: 'Evil' as unknown as AzureRemediationAssetClass, appId: SP_STORAGE },
        ],
      }),
    ).toThrow(/unknown Azure asset class/);
  });

  it('escapes the email so it cannot break shell quoting', () => {
    const script = getAzureRemediationDetectionScript({
      ...BASE_OPTIONS,
      email: 'a"b@example.com',
    });
    expect(script).toContain('a\\"b@example.com');
  });
});
