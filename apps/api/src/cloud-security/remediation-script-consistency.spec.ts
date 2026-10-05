jest.mock('@db', () => ({}));

// Guards the denylist invariant: the per-pair CloudShell setup scripts must
// not grant anything the runtime denylist refuses to auto-grant. If this
// test fails, either a pair template regained a blocked action or the
// denylist changed — reconcile them deliberately, don't just update one
// side.
import {
  getAwsRemediationScriptForPair,
  REMEDIATION_ASSET_CLASSES,
  type RemediationAssetClass,
} from '@gideon-defender/integration-platform';
import { isBlockedRemediationAction } from './remediation-denylist';

function extractAllowActions(script: string): string[] {
  // Only Allow statements count: the region/destructive Deny blocks
  // deliberately name blocked actions, which must not trip the guard.
  const actions: string[] = [];
  const effectRe = /"Effect":\s*"(Allow|Deny)"/g;
  const actionRe = /"Action":\s*\[([^\]]*)\]/g;
  const effects: Array<{ index: number; effect: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = effectRe.exec(script)) !== null) {
    effects.push({ index: match.index, effect: match[1] });
  }
  while ((match = actionRe.exec(script)) !== null) {
    const actionIndex = match.index;
    const preceding = effects.filter((e) => e.index < actionIndex).pop();
    if (preceding?.effect !== 'Allow') continue;
    const raw = match[1] ?? '';
    for (const part of raw.split(',')) {
      const action = part.trim().replace(/^"|"$/g, '');
      if (action) actions.push(action);
    }
  }
  return actions;
}

function pairScript(assetClass: RemediationAssetClass): string {
  return getAwsRemediationScriptForPair(
    'aws',
    { assetClass, region: 'us-east-1' },
    'org_test_external_id',
  );
}

describe('remediation pair scripts vs denylist consistency', () => {
  it.each(REMEDIATION_ASSET_CLASSES)(
    'grants no blocked actions (%s)',
    (assetClass) => {
      const actions = extractAllowActions(pairScript(assetClass));
      expect(actions.length).toBeGreaterThan(0);
      const blocked = actions.filter((a) => isBlockedRemediationAction(a));
      expect(blocked).toEqual([]);
    },
  );

  it.each(REMEDIATION_ASSET_CLASSES)(
    'reuses an existing role instead of failing on re-run (%s)',
    (assetClass) => {
      const script = pairScript(assetClass);
      // Idempotent create: fall back to create-role only when get-role misses.
      expect(script).toContain('aws iam get-role --role-name "$ROLE_NAME"');
      expect(script).toContain('|| aws iam create-role');
    },
  );

  it.each(REMEDIATION_ASSET_CLASSES)(
    'warns that re-runs reset (not merge) the trust policy (%s)',
    (assetClass) => {
      const script = pairScript(assetClass);
      expect(script).toContain('RESET');
      expect(script).toContain('custom principals');
    },
  );

  it.each(REMEDIATION_ASSET_CLASSES)(
    'pins the highest-risk actions as absent from grants (%s)',
    (assetClass) => {
      // The live-vs-live check above passes if both sides drift together.
      // These literals fail if the exact actions that motivated the denylist
      // are ever granted. Checked against granted (Allow) actions only —
      // the destructive-Deny statements deliberately name them.
      // (`sts:AssumeRole` is intentionally absent here — the role trust policy
      // legitimately names it; the grant-side ban is covered by the denylist.)
      const granted = extractAllowActions(pairScript(assetClass));
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
        expect(granted).not.toContain(action);
      }
    },
  );

  it.each(REMEDIATION_ASSET_CLASSES)(
    'caps sessions at the IAM minimum and converges the cap on re-run (%s)',
    (assetClass) => {
      // IAM roles require max-session-duration 3600-43200. The API requests
      // 900s sessions which fit inside the 3600 cap.
      const script = pairScript(assetClass);
      expect(script).toContain('--max-session-duration 3600');
      expect(script).not.toContain('--max-session-duration 900');
      expect(script).toContain(
        'aws iam update-role --role-name "$ROLE_NAME" --max-session-duration 3600',
      );
    },
  );

  it.each(REMEDIATION_ASSET_CLASSES)(
    'converges the trust policy on re-run (%s)',
    (assetClass) => {
      const script = pairScript(assetClass);
      expect(script).toContain(
        'aws iam update-assume-role-policy --role-name "$ROLE_NAME"',
      );
    },
  );

  it.each(REMEDIATION_ASSET_CLASSES)(
    'writes a single pair policy document (%s)',
    (assetClass) => {
      const script = pairScript(assetClass);
      expect(script).toContain('--policy-name OpenComp-Remediation');
    },
  );
});
