import { describe, expect, it } from 'vitest';
import {
  AZURE_APPROVAL_GATED_SURFACES,
  AZURE_REMEDIATION_DETECTION_DESCRIPTIONS,
  AZURE_REMEDIATION_DETECTION_RULES,
  buildAzureApprovalGatedConditions,
  buildAzureDetectionConditions,
  buildAzureForensicQueries,
  buildAzureRemediatorDeniedConditions,
  buildAzureRemediatorWriteConditions,
  renderAzureAlertCondition,
} from '../remediation-detection-filters';

const SP_A = '11111111-1111-1111-1111-111111111111';
const SP_B = '22222222-2222-2222-2222-222222222222';
const SUB = '12345678-1234-1234-1234-1234567890ab';

describe('detection rules', () => {
  it('exposes three signals with descriptions', () => {
    expect([...AZURE_REMEDIATION_DETECTION_RULES]).toEqual([
      'OpenComp-RemediatorWrite',
      'OpenComp-RemediatorDenied',
      'OpenComp-RemediatorApprovalGated',
    ]);
    for (const rule of AZURE_REMEDIATION_DETECTION_RULES) {
      expect(AZURE_REMEDIATION_DETECTION_DESCRIPTIONS[rule]).toMatch(/OpenComp/);
    }
  });

  it('lists the approval-gated surfaces with short codes', () => {
    const types = AZURE_APPROVAL_GATED_SURFACES.map((entry) => entry.resourceType);
    expect(types).toContain('Microsoft.Authorization/roleAssignments');
    expect(types).toContain('Microsoft.Authorization/roleDefinitions');
    expect(types).toContain('Microsoft.KeyVault/vaults');
  });
});

describe('buildAzureRemediatorWriteConditions', () => {
  it('matches the SP caller on succeeded control-plane writes', () => {
    expect(buildAzureRemediatorWriteConditions(SP_A)).toEqual([
      { field: 'caller', equals: SP_A },
      { field: 'category', equals: 'Administrative' },
      { field: 'status', equals: 'Succeeded' },
    ]);
  });

  it('rejects non-GUID callers so the script cannot emit a broken rule', () => {
    expect(() => buildAzureRemediatorWriteConditions('not-a-guid')).toThrow(
      /application \(client\) ID/,
    );
    expect(() => buildAzureRemediatorWriteConditions('')).toThrow();
  });
});

describe('buildAzureRemediatorDeniedConditions', () => {
  it('matches failed calls with no category so no hit is missed', () => {
    const conditions = buildAzureRemediatorDeniedConditions(SP_A);
    expect(conditions).toContainEqual({ field: 'caller', equals: SP_A });
    expect(conditions).toContainEqual({ field: 'status', equals: 'Failed' });
    expect(conditions.some((entry) => entry.field === 'category')).toBe(false);
  });
});

describe('buildAzureApprovalGatedConditions', () => {
  it('pins caller, category, and the gated resource type', () => {
    expect(buildAzureApprovalGatedConditions({ spAppId: SP_A, surfaceCode: 'RoleAssign' })).toEqual(
      [
        { field: 'caller', equals: SP_A },
        { field: 'category', equals: 'Administrative' },
        { field: 'resourceType', equals: 'Microsoft.Authorization/roleAssignments' },
      ],
    );
  });

  it('rejects unknown surface codes', () => {
    expect(() => buildAzureApprovalGatedConditions({ spAppId: SP_A, surfaceCode: 'Evil' })).toThrow(
      /unknown Azure approval-gated surface/,
    );
  });
});

describe('buildAzureDetectionConditions', () => {
  it('dispatches each rule to its builder', () => {
    expect(
      buildAzureDetectionConditions({ rule: 'OpenComp-RemediatorWrite', spAppId: SP_A }),
    ).toEqual(buildAzureRemediatorWriteConditions(SP_A));
    expect(
      buildAzureDetectionConditions({ rule: 'OpenComp-RemediatorDenied', spAppId: SP_A }),
    ).toEqual(buildAzureRemediatorDeniedConditions(SP_A));
    expect(
      buildAzureDetectionConditions({
        rule: 'OpenComp-RemediatorApprovalGated',
        spAppId: SP_A,
        surfaceCode: 'KeyVault',
      }),
    ).toEqual(buildAzureApprovalGatedConditions({ spAppId: SP_A, surfaceCode: 'KeyVault' }));
  });

  it('requires a surface code for the approval-gated rule', () => {
    expect(() =>
      buildAzureDetectionConditions({ rule: 'OpenComp-RemediatorApprovalGated', spAppId: SP_A }),
    ).toThrow(/surfaceCode/);
  });

  it('rejects unknown rules', () => {
    expect(() => buildAzureDetectionConditions({ rule: 'Nope', spAppId: SP_A })).toThrow(
      /unknown Azure remediation detection rule/,
    );
  });
});

describe('renderAzureAlertCondition', () => {
  it('renders CLI and-joined field=value pairs', () => {
    expect(renderAzureAlertCondition(buildAzureRemediatorWriteConditions(SP_A))).toBe(
      `caller=${SP_A} and category=Administrative and status=Succeeded`,
    );
  });
});

describe('buildAzureForensicQueries', () => {
  it('returns three queries embedding every SP caller', () => {
    const queries = buildAzureForensicQueries({ spAppIds: [SP_A, SP_B], subscriptionId: SUB });
    expect(queries.map((query) => query.name)).toEqual([
      'azure-remediator-writes-7d',
      'azure-remediator-denied-7d',
      'azure-remediator-approval-gated-30d',
    ]);
    for (const query of queries) {
      expect(query.kql).toContain(`"${SP_A}"`);
      expect(query.kql).toContain(`"${SP_B}"`);
      expect(query.azCli).toContain(SUB);
    }
    expect(queries[1]?.azCli).toContain('--status Failed');
  });

  it('requires at least one SP and valid IDs', () => {
    expect(() => buildAzureForensicQueries({ spAppIds: [], subscriptionId: SUB })).toThrow(
      /at least one/,
    );
    expect(() => buildAzureForensicQueries({ spAppIds: ['nope'], subscriptionId: SUB })).toThrow();
  });

  it('rejects bad subscription ids so the CLI cannot emit a broken command', () => {
    expect(() => buildAzureForensicQueries({ spAppIds: [SP_A], subscriptionId: 'nope' })).toThrow(
      /subscription id/,
    );
    expect(() => buildAzureForensicQueries({ spAppIds: [SP_A], subscriptionId: '' })).toThrow();
    expect(() =>
      buildAzureForensicQueries({ spAppIds: [SP_A], subscriptionId: 'abc"$(evil)"def' }),
    ).toThrow();
  });

  it('covers both approval-gated providers in the CLI equivalent', () => {
    const queries = buildAzureForensicQueries({ spAppIds: [SP_A], subscriptionId: SUB });
    expect(queries[2]?.azCli).toContain('--resource-provider Microsoft.Authorization');
    expect(queries[2]?.azCli).toContain('--resource-provider Microsoft.KeyVault');
  });
});
