import { describe, expect, it } from 'vitest';

import {
  buildFindingPermissionsScript,
  buildMissingPermsMergeScript,
  isGuidanceOnlyScript,
} from './batch-merge-script';

describe('buildFindingPermissionsScript', () => {
  it('emits an executable merge script when everything is grantable', () => {
    const { script, grantable, blocked } = buildFindingPermissionsScript([
      's3:PutBucketEncryption',
      'logs:PutMetricFilter',
    ]);
    expect(blocked).toEqual([]);
    expect(grantable).toEqual(['logs:PutMetricFilter', 's3:PutBucketEncryption']);
    expect(script).toContain('put-role-policy');
    expect(script).not.toContain('WARNING');
    expect(script).not.toContain('manual review');
    expect(isGuidanceOnlyScript(script)).toBe(false);
  });

  it('omits blocked actions from NEW while warning (never Deny)', () => {
    const { script, blocked } = buildFindingPermissionsScript([
      's3:PutBucketEncryption',
      'iam:PutRolePolicy',
    ]);
    expect(blocked).toEqual(['iam:PutRolePolicy']);
    expect(script).toContain('WARNING');
    expect(script).toContain('iam:PutRolePolicy');
    // The blocked action appears only in the comment — never quoted inside
    // the policy JSON that NEW carries.
    expect(script).not.toContain('"iam:PutRolePolicy"');
    expect(script).toContain('put-role-policy');
  });

  it('returns guidance (no command) when every action is blocked', () => {
    const { script } = buildFindingPermissionsScript(['iam:PassRole', 's3:PutBucketPolicy']);
    expect(script).toMatch(/manual review/i);
    expect(script).not.toContain('put-role-policy');
    expect(isGuidanceOnlyScript(script)).toBe(true);
  });

  it('renders the routed pair role in the header', () => {
    const { script } = buildFindingPermissionsScript(
      ['s3:PutBucketEncryption'],
      'OpenComp-Remediator-Storage-us-east-1',
    );
    expect(script).toContain('ROLE="OpenComp-Remediator-Storage-us-east-1"');
  });

  it('reads the full policy so Deny/Conditions survive (no [0] truncation)', () => {
    const { script } = buildFindingPermissionsScript(['s3:PutBucketEncryption']);
    // The full PolicyDocument feeds the merge — Deny statements, Conditions,
    // and scoped Resources survive re-runs instead of being replaced.
    expect(script).toContain('--query PolicyDocument --output json');
    expect(script).toContain('select(.Effect != "Allow")');
    expect(script).not.toContain('| [0]');
    // `[.. | strings]` flattens arrays, single strings, and null alike.
    expect(script).toContain('[.. | strings]');
  });
});

describe('buildMissingPermsMergeScript', () => {
  it('emits the merge flow with grantable permissions only', () => {
    const { script, blocked } = buildMissingPermsMergeScript([
      's3:PutBucketEncryption',
      'iam:PassRole',
    ]);
    expect(blocked).toEqual(['iam:PassRole']);
    expect(script).toContain('WARNING');
    expect(script).toContain('NEW_PERMS=\'["s3:PutBucketEncryption"]\'');
    expect(script).not.toContain('"iam:PassRole"');
    expect(script).toContain('[.. | strings]');
    expect(script).not.toContain('| [0]');
  });

  it('returns guidance (no command) when every action is blocked', () => {
    const { script } = buildMissingPermsMergeScript(['iam:PassRole']);
    expect(script).toMatch(/manual review/i);
    expect(script).not.toContain('put-role-policy');
    expect(isGuidanceOnlyScript(script)).toBe(true);
  });

  it('renders the routed pair role in the header instead of the monolith default', () => {
    const { script } = buildMissingPermsMergeScript(
      ['s3:PutBucketEncryption'],
      'OpenComp-Remediator-Storage-us-east-1',
    );
    expect(script).toContain('ROLE="OpenComp-Remediator-Storage-us-east-1"');
    expect(script).not.toContain('ROLE="OpenComp-Remediator"');
  });

  it('keeps the monolith default when no role is routed', () => {
    const { script } = buildMissingPermsMergeScript(['s3:PutBucketEncryption']);
    expect(script).toContain('ROLE="OpenComp-Remediator"');
  });

  it('throws fail-closed on an unsafe routed role name', () => {
    expect(() =>
      buildMissingPermsMergeScript(['s3:PutBucketEncryption'], 'Storage"; evil #'),
    ).toThrow(/malformed ROLE header|unsafe role name/);
  });
});

describe('isGuidanceOnlyScript', () => {
  it('rejects executable commands and null', () => {
    expect(isGuidanceOnlyScript('aws iam put-role-policy --role-name X')).toBe(false);
    expect(isGuidanceOnlyScript(null)).toBe(false);
  });

  it('treats every backend comment-only script as guidance', () => {
    // Backend guidance wordings (ai-remediation.service suggestPermissionFix
    // paths and buildStaticPermissionScript fallbacks) carry no `aws ` line.
    for (const script of [
      '# No grantable permissions — every requested action (2) requires manual review and cannot be added via auto-fix: iam:PassRole, s3:PutBucketPolicy',
      '# Could not determine the missing IAM action from the error. Check the error message and add the required permission manually to the OpenComp-Remediator role.',
      '# WARNING: iam:PassRole require(s) manual review and cannot be added via auto-fix. Add them in the AWS console only if you understand the impact.',
    ]) {
      expect(isGuidanceOnlyScript(script)).toBe(true);
    }
  });

  it('still treats warning-plus-command scripts as runnable', () => {
    const { script } = buildFindingPermissionsScript([
      's3:PutBucketEncryption',
      'iam:PutRolePolicy',
    ]);
    expect(script).toContain('WARNING');
    expect(isGuidanceOnlyScript(script)).toBe(false);
  });

  it('treats service-linked-role commands as runnable', () => {
    expect(
      isGuidanceOnlyScript(
        'aws iam create-service-linked-role --aws-service-name guardduty.amazonaws.com',
      ),
    ).toBe(false);
  });
});
