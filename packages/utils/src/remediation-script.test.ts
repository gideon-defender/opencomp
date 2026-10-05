import { describe, expect, it } from 'vitest';
import {
  formatBlockedActionsForDisplay,
  rolePolicyMergeScriptLines,
  splitBlockedRemediationActions,
} from './remediation-denylist';
import { buildRemediationGrantScript } from './remediation-script';

const PAIR_ROLE = 'OpenComp-Remediator-Storage-us-east-1';

describe('buildRemediationGrantScript', () => {
  it('emits the backend AutoFix shape by default', () => {
    const script = buildRemediationGrantScript({
      permissions: ['s3:ListBucket'],
      policyName: 'OpenComp-AutoFix',
      roleName: PAIR_ROLE,
    });
    expect(script).toContain(`ROLE="${PAIR_ROLE}" POLICY="OpenComp-AutoFix"`);
    expect(script).toContain(`NEW='${JSON.stringify(['s3:ListBucket'])}'`);
    expect(script).toContain('aws iam put-role-policy');
    expect(script).not.toContain('WARNING');
  });

  it('refuses shell-unsafe role names instead of rendering a poisoned header', () => {
    for (const roleName of [
      'OpenComp-Remediator"; evil #',
      'OpenComp-Remediator-$(whoami)',
      'OpenComp-Remediator-`id`',
    ]) {
      expect(() =>
        buildRemediationGrantScript({ permissions: ['s3:ListBucket'], roleName }),
      ).toThrow(/unsafe role name/);
      expect(() =>
        buildRemediationGrantScript({
          permissions: ['s3:ListBucket'],
          roleName: PAIR_ROLE,
          roleHeaderLines: [`ROLE="${roleName}"`, 'POLICY="P"'],
        }),
      ).toThrow(/unsafe role name|malformed ROLE header/);
    }
  });

  it('omits blocked actions and warns instead of denying', () => {
    const script = buildRemediationGrantScript({
      permissions: ['s3:ListBucket', 'iam:PassRole'],
      policyName: 'OpenComp-AutoFix',
      roleName: PAIR_ROLE,
    });
    expect(script).toContain('WARNING');
    expect(script).toContain('iam:PassRole');
    expect(script).not.toContain('"iam:PassRole"');
    expect(script).not.toMatch(/"Effect": "Deny"|Effect: Deny/);
  });

  it('returns a comment-only script when nothing is grantable', () => {
    const script = buildRemediationGrantScript({
      permissions: ['iam:PassRole'],
      policyName: 'OpenComp-AutoFix',
      roleName: PAIR_ROLE,
    });
    expect(script.startsWith('# No grantable permissions')).toBe(true);
    expect(script).not.toContain('aws iam put-role-policy');
  });

  it('supports caller policy names, variables, and extra lines', () => {
    const script = buildRemediationGrantScript({
      permissions: ['s3:ListBucket'],
      roleName: PAIR_ROLE,
      variableName: 'NEW_PERMS',
      warningLine: () => '',
      extraHeaderLines: ['# custom header'],
      roleHeaderLines: ['ROLE="R"', 'POLICY="P"'],
      preMergeLines: ['# before merge'],
      postMergeLines: ['echo done'],
    });
    const lines = script.split('\n');
    expect(lines).toContain('ROLE="R"');
    expect(lines).toContain('POLICY="P"');
    expect(lines).toContain('# custom header');
    expect(lines).toContain('# before merge');
    expect(lines).toContain('echo done');
    expect(script).toContain(`NEW_PERMS='${JSON.stringify(['s3:ListBucket'])}'`);
    // The merge block references the caller's variable, not the default.
    expect(script).toContain('$NEW_PERMS');
    expect(script).not.toContain('$NEW ');
  });

  it('matches the batch finding-builder output exactly', () => {
    // Guards the unification: the shared helper must render byte-identical
    // scripts to the hand-rolled builder it replaced.
    const permissions = ['s3:ListBucket', 'iam:PassRole'];
    const script = buildRemediationGrantScript({
      permissions,
      policyName: 'OpenComp-BatchPermissions',
      roleName: PAIR_ROLE,
      warningLine: ({ count, display }) =>
        `# WARNING: excluded ${count} permission(s) requiring manual review: ${display}`,
    });
    const { allowed, blocked } = splitBlockedRemediationActions(permissions);
    const expected = [
      `# WARNING: excluded 1 permission(s) requiring manual review: ${formatBlockedActionsForDisplay(blocked)}`,
      `ROLE="${PAIR_ROLE}" POLICY="OpenComp-BatchPermissions"`,
      `NEW='${JSON.stringify(allowed)}'`,
      ...rolePolicyMergeScriptLines('NEW'),
    ].join('\n');
    expect(script).toBe(expected);
  });
});
