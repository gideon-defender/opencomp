jest.mock('@db', () => ({}));

// Guards the denylist invariant: the static CloudShell setup script must not
// grant anything the runtime denylist refuses to auto-grant. If this test
// fails, either the script regained a blocked action or the denylist changed
// — reconcile them deliberately, don't just update one side.
import { getAwsRemediationScript } from '@gideon-defender/integration-platform';
import { isBlockedRemediationAction } from './remediation-denylist';

function extractAllowActions(script: string): string[] {
  const actions: string[] = [];
  const re = /"Action":\s*\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(script)) !== null) {
    const raw = match[1] ?? '';
    for (const part of raw.split(',')) {
      const action = part.trim().replace(/^"|"$/g, '');
      if (action) actions.push(action);
    }
  }
  return actions;
}

describe('remediation setup script vs denylist consistency', () => {
  it('grants no blocked actions', () => {
    const script = getAwsRemediationScript('aws');
    const actions = extractAllowActions(script);
    expect(actions.length).toBeGreaterThan(0);
    const blocked = actions.filter((a) => isBlockedRemediationAction(a));
    expect(blocked).toEqual([]);
  });

  it('reuses an existing role instead of failing on re-run', () => {
    const script = getAwsRemediationScript('aws');
    // Idempotent create: fall back to create-role only when get-role misses.
    expect(script).toContain('aws iam get-role --role-name "$ROLE_NAME"');
    expect(script).toContain('|| aws iam create-role');
  });

  it('warns that re-runs reset (not merge) the trust policy', () => {
    const script = getAwsRemediationScript('aws');
    expect(script).toContain('RESET');
    expect(script).toContain('custom principals');
  });

  it('removes the legacy destructive rollback policy', () => {
    const script = getAwsRemediationScript('aws');
    expect(script).toContain(
      'aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name OpenComp-Rollback',
    );
  });

  it('pins the highest-risk actions as absent (catches joint drift)', () => {
    // The live-vs-live check above passes if both sides drift together.
    // These literals fail if the exact actions that motivated the denylist return.
    // (`sts:AssumeRole` is intentionally absent here — the role trust policy
    // legitimately names it; the grant-side ban is covered by the denylist.)
    const script = getAwsRemediationScript('aws');
    for (const action of [
      'iam:PutRolePolicy',
      'iam:PassRole',
      'iam:CreateRole',
      's3:PutBucketPolicy',
      's3:PutBucketAcl',
      's3:PutReplicationConfiguration',
      'kms:PutKeyPolicy',
      'ec2:AuthorizeSecurityGroupIngress',
      'guardduty:UpdateDetector',
      'ssm:SendCommand',
      'ssm:UpdateServiceSetting',
      'lambda:AddPermission',
    ]) {
      expect(script).not.toContain(`"${action}"`);
    }
  });

  it('caps sessions at the IAM minimum and converges the cap on re-run', () => {
    // IAM roles require max-session-duration 3600-43200. The API requests
    // 900s sessions which fit inside the 3600 cap.
    const script = getAwsRemediationScript('aws');
    expect(script).toContain('--max-session-duration 3600');
    expect(script).not.toContain('--max-session-duration 900');
    expect(script).toContain(
      'aws iam update-role --role-name "$ROLE_NAME" --max-session-duration 3600',
    );
  });

  it('converges the trust policy on re-run', () => {
    const script = getAwsRemediationScript('aws');
    expect(script).toContain(
      'aws iam update-assume-role-policy --role-name "$ROLE_NAME"',
    );
  });

  it('uses consistent policy-name casing and cleans up the legacy name', () => {
    const script = getAwsRemediationScript('aws');
    expect(script).toContain('--policy-name OpenComp-SecurityRemediation');
    expect(script).not.toContain(
      'put-role-policy --role-name "$ROLE_NAME" --policy-name opencomp-securityRemediation',
    );
    expect(script).toContain(
      'aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name opencomp-securityRemediation',
    );
  });
});
