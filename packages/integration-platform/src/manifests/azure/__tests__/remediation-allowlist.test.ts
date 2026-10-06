import { describe, expect, it } from 'vitest';
import {
  AZURE_FIX_FORWARD_ACTIONS,
  AZURE_NEVER_ALLOW_ACTIONS,
  AZURE_NEVER_ALLOW_ROLES,
  buildAzureCustomRoleDefinition,
} from '../remediation-allowlist';
import { AZURE_REMEDIATION_ASSET_CLASSES } from '../remediation-roles';

const SUB = '12345678-1234-1234-1234-1234567890ab';

describe('azure fix-forward actions', () => {
  it('covers every asset class with a non-empty action list', () => {
    for (const assetClass of AZURE_REMEDIATION_ASSET_CLASSES) {
      const actions = AZURE_FIX_FORWARD_ACTIONS[assetClass];
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action).toMatch(/^Microsoft\./);
        expect(action).not.toContain('*');
      }
    }
  });

  it('keeps fix-forward and never-allow disjoint (deny wins, so overlap hides coverage)', () => {
    const never = new Set(AZURE_NEVER_ALLOW_ACTIONS.map((action) => action.toLowerCase()));
    for (const assetClass of AZURE_REMEDIATION_ASSET_CLASSES) {
      for (const action of AZURE_FIX_FORWARD_ACTIONS[assetClass]) {
        expect(never.has(action.toLowerCase())).toBe(false);
      }
    }
  });
});

describe('azure never-allow lists', () => {
  it('forbids role-assignment and role-definition writes', () => {
    const actions = AZURE_NEVER_ALLOW_ACTIONS.map((action) => action.toLowerCase());
    expect(actions).toContain('microsoft.authorization/roleassignments/write');
    expect(actions).toContain('microsoft.authorization/roledefinitions/write');
  });

  it('forbids the privileged built-in and directory roles', () => {
    expect(AZURE_NEVER_ALLOW_ROLES).toContain('Owner');
    expect(AZURE_NEVER_ALLOW_ROLES).toContain('Contributor');
    expect(AZURE_NEVER_ALLOW_ROLES).toContain('User Access Administrator');
    expect(AZURE_NEVER_ALLOW_ROLES).toContain('Global Administrator');
    expect(AZURE_NEVER_ALLOW_ROLES).toContain('Privileged Role Administrator');
  });
});

describe('buildAzureCustomRoleDefinition', () => {
  it('emits a scoped role document with fix-forward actions and never-allow NotActions', () => {
    const role = buildAzureCustomRoleDefinition({
      assetClass: 'Storage',
      assignableScope: `/subscriptions/${SUB}`,
    });
    expect(role.roleName).toBe('OpenComp Remediator (Storage)');
    expect(role.assignableScopes).toEqual([`/subscriptions/${SUB}`]);
    expect(role.permissions).toHaveLength(1);
    expect(role.permissions[0].actions).toEqual(AZURE_FIX_FORWARD_ACTIONS.Storage);
    for (const denied of AZURE_NEVER_ALLOW_ACTIONS) {
      expect(role.permissions[0].notActions).toContain(denied);
    }
    expect(role.permissions[0].dataActions).toEqual([]);
    expect(role.description.length).toBeGreaterThan(0);
  });

  it('scopes every class to the given subscription only', () => {
    for (const assetClass of AZURE_REMEDIATION_ASSET_CLASSES) {
      const role = buildAzureCustomRoleDefinition({
        assetClass,
        assignableScope: `/subscriptions/${SUB}`,
      });
      expect(role.assignableScopes).toEqual([`/subscriptions/${SUB}`]);
    }
  });
});
