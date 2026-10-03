import { execFileSync } from 'node:child_process';
import {
  extractIamActionsFromErrorMessage,
  formatBlockedActionsForDisplay,
  isBlockedRemediationAction,
  rolePolicyMergeScriptLines,
  splitBlockedRemediationActions,
} from './remediation-denylist';

describe('isBlockedRemediationAction', () => {
  it('blocks exact privilege-escalation actions', () => {
    expect(isBlockedRemediationAction('iam:PutRolePolicy')).toBe(true);
    expect(isBlockedRemediationAction('iam:CreateRole')).toBe(true);
    expect(isBlockedRemediationAction('iam:PassRole')).toBe(true);
    expect(isBlockedRemediationAction('iam:CreateServiceLinkedRole')).toBe(
      true,
    );
  });

  it('blocks every non-read iam action via the generic IAM rule', () => {
    expect(isBlockedRemediationAction('iam:AttachRolePolicy')).toBe(true);
    expect(isBlockedRemediationAction('iam:UpdateAssumeRolePolicy')).toBe(true);
    expect(isBlockedRemediationAction('iam:GetRole')).toBe(false);
    expect(isBlockedRemediationAction('iam:ListRolePolicies')).toBe(false);
    expect(isBlockedRemediationAction('iam:GetAccountPasswordPolicy')).toBe(
      false,
    );
  });

  it('blocks kill-switch verbs across services', () => {
    expect(isBlockedRemediationAction('cloudtrail:StopLogging')).toBe(true);
    expect(isBlockedRemediationAction('guardduty:DeleteDetector')).toBe(true);
    expect(isBlockedRemediationAction('kms:DisableKeyRotation')).toBe(true);
    expect(isBlockedRemediationAction('inspector2:Disable')).toBe(true);
    expect(isBlockedRemediationAction('macie2:DisableMacie')).toBe(true);
    expect(isBlockedRemediationAction('config:StopConfigurationRecorder')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('sns:Unsubscribe')).toBe(true);
    expect(isBlockedRemediationAction('lambda:RemovePermission')).toBe(true);
    expect(isBlockedRemediationAction('kms:ScheduleKeyDeletion')).toBe(true);
    expect(isBlockedRemediationAction('sqs:PurgeQueue')).toBe(true);
  });

  it('blocks irreversible and disruptive verbs outside the original list', () => {
    // Fail-open tail: anything outside the verb prefixes, the exact set,
    // and the ACL/IAM/STS rules returns grantable. These families must not
    // slip through — none of them is ever a fix.
    expect(isBlockedRemediationAction('account:CloseAccount')).toBe(true);
    expect(isBlockedRemediationAction('ec2:RebootInstances')).toBe(true);
    expect(isBlockedRemediationAction('rds:RebootDBInstance')).toBe(true);
    expect(isBlockedRemediationAction('shield:CancelSubscription')).toBe(true);
    expect(isBlockedRemediationAction('organizations:LeaveOrganization')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('ec2:SuspendDevices')).toBe(true);
  });

  it('blocks compute execution primitives (never a fix, always RCE shaped)', () => {
    expect(isBlockedRemediationAction('ec2:RunInstances')).toBe(true);
    expect(isBlockedRemediationAction('ec2:StartInstances')).toBe(true);
    expect(isBlockedRemediationAction('lambda:InvokeFunction')).toBe(true);
    expect(isBlockedRemediationAction('states:StartExecution')).toBe(true);
    expect(isBlockedRemediationAction('ecs:RunTask')).toBe(true);
    expect(isBlockedRemediationAction('batch:SubmitJob')).toBe(true);
  });

  it('blocks exfiltration / cost / disruptive exact actions', () => {
    expect(isBlockedRemediationAction('s3:PutBucketPolicy')).toBe(true);
    expect(isBlockedRemediationAction('s3:CreateBucket')).toBe(true);
    expect(isBlockedRemediationAction('sns:Subscribe')).toBe(true);
    expect(isBlockedRemediationAction('events:PutPermission')).toBe(true);
    expect(isBlockedRemediationAction('shield:CreateSubscription')).toBe(true);
    expect(isBlockedRemediationAction('rds:ModifyDBInstance')).toBe(true);
    expect(isBlockedRemediationAction('wafv2:UpdateWebACL')).toBe(true);
    expect(isBlockedRemediationAction('wafv2:DisassociateWebACL')).toBe(true);
    // Detaching volumes and gateways disables through EC2, same shape.
    expect(isBlockedRemediationAction('ec2:DetachVolume')).toBe(true);
    expect(isBlockedRemediationAction('ec2:DetachInternetGateway')).toBe(true);
    // Attaching protection only ever adds it — stays grantable.
    expect(isBlockedRemediationAction('wafv2:AssociateWebACL')).toBe(false);
    expect(isBlockedRemediationAction('cognito-idp:UpdateUserPool')).toBe(true);
    expect(isBlockedRemediationAction('codebuild:UpdateProject')).toBe(true);
    expect(isBlockedRemediationAction('states:UpdateStateMachine')).toBe(true);
    expect(isBlockedRemediationAction('ssm:CreateDocument')).toBe(true);
    expect(
      isBlockedRemediationAction('lambda:UpdateFunctionConfiguration'),
    ).toBe(true);
    expect(isBlockedRemediationAction('eks:UpdateClusterConfig')).toBe(true);
    expect(isBlockedRemediationAction('es:UpdateDomainConfig')).toBe(true);
    expect(isBlockedRemediationAction('secretsmanager:RotateSecret')).toBe(
      true,
    );
  });

  it('blocks network-opening and key-takeover writes', () => {
    expect(
      isBlockedRemediationAction('ec2:AuthorizeSecurityGroupIngress'),
    ).toBe(true);
    expect(isBlockedRemediationAction('ec2:AuthorizeSecurityGroupEgress')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('kms:PutKeyPolicy')).toBe(true);
    expect(isBlockedRemediationAction('kms:CreateGrant')).toBe(true);
    expect(isBlockedRemediationAction('kms:CreateKey')).toBe(true);
    expect(isBlockedRemediationAction('kms:RetireGrant')).toBe(true);
    expect(isBlockedRemediationAction('s3:PutReplicationConfiguration')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('s3:PutAccessPointPolicy')).toBe(true);
    expect(isBlockedRemediationAction('s3:CreateAccessPoint')).toBe(true);
  });

  it('blocks traffic-reroute and snapshot-export primitives', () => {
    expect(isBlockedRemediationAction('route53:ChangeResourceRecordSets')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('elbv2:ModifyListener')).toBe(true);
    expect(isBlockedRemediationAction('elbv2:ModifyTargetGroup')).toBe(true);
    expect(isBlockedRemediationAction('elbv2:CreateListener')).toBe(true);
    expect(isBlockedRemediationAction('elbv2:CreateTargetGroup')).toBe(true);
    expect(isBlockedRemediationAction('elbv2:RegisterTargets')).toBe(true);
    expect(isBlockedRemediationAction('rds:StartExportTask')).toBe(true);
    expect(
      isBlockedRemediationAction('dynamodb:ExportTableToPointInTime'),
    ).toBe(true);
  });

  it('allows cloudfront:UpdateDistribution (it IS the CloudFront fix mechanism)', () => {
    expect(isBlockedRemediationAction('cloudfront:UpdateDistribution')).toBe(
      false,
    );
  });

  it('allows security-group revoke (closing rules is the fix, never exposure)', () => {
    // `Revoke` must stay out of the verb denylist: revoking ingress/egress
    // closes offending rules, which IS the fix for open-group findings.
    expect(isBlockedRemediationAction('ec2:RevokeSecurityGroupIngress')).toBe(
      false,
    );
    expect(isBlockedRemediationAction('ec2:RevokeSecurityGroupEgress')).toBe(
      false,
    );
    // Opening rules stays blocked.
    expect(
      isBlockedRemediationAction('ec2:AuthorizeSecurityGroupIngress'),
    ).toBe(true);
  });

  it('blocks resource-policy exposure siblings of the sqs/events vectors', () => {
    expect(isBlockedRemediationAction('lambda:AddPermission')).toBe(true);
    expect(isBlockedRemediationAction('sns:AddPermission')).toBe(true);
    expect(isBlockedRemediationAction('events:PutTargets')).toBe(true);
    expect(isBlockedRemediationAction('events:PutRule')).toBe(true);
    expect(isBlockedRemediationAction('ecr:SetRepositoryPolicy')).toBe(true);
    expect(isBlockedRemediationAction('secretsmanager:PutResourcePolicy')).toBe(
      true,
    );
  });

  it('blocks the SSM execution primitives, not just document management', () => {
    expect(isBlockedRemediationAction('ssm:SendCommand')).toBe(true);
    expect(isBlockedRemediationAction('ssm:StartSession')).toBe(true);
    // Same interactive-shell primitive through a different verb.
    expect(isBlockedRemediationAction('ssm:ResumeSession')).toBe(true);
    expect(isBlockedRemediationAction('ssm:StartAutomationExecution')).toBe(
      true,
    );
  });

  it('blocks detector disable-via-update while keeping detector creation', () => {
    // UpdateDetector takes `Enable: false` — no Delete/Disable/Stop verb for
    // the generic rule to catch. Creation stays allowed; updates need review.
    expect(isBlockedRemediationAction('guardduty:UpdateDetector')).toBe(true);
    expect(isBlockedRemediationAction('guardduty:CreateDetector')).toBe(false);
  });

  it('blocks every guardduty update via the service-scoped backstop', () => {
    // Per-member and destination updates blind detection the same way as
    // UpdateDetector. The exact list names them for audits; the
    // service-scoped rule backstops future `Update*` additions.
    expect(isBlockedRemediationAction('guardduty:UpdateMemberDetectors')).toBe(
      true,
    );
    expect(
      isBlockedRemediationAction('guardduty:UpdatePublishingDestination'),
    ).toBe(true);
    expect(
      isBlockedRemediationAction('guardduty:UpdateOrganizationConfiguration'),
    ).toBe(true);
    expect(isBlockedRemediationAction('guardduty:UpdateFilter')).toBe(true);
    expect(isBlockedRemediationAction('guardduty:UpdateIPSet')).toBe(true);
    // Reads and creation stay allowed — auditors need them, and creation is
    // the fix for missing detectors.
    expect(isBlockedRemediationAction('guardduty:GetDetector')).toBe(false);
    expect(isBlockedRemediationAction('guardduty:ListDetectors')).toBe(false);
    expect(isBlockedRemediationAction('guardduty:CreateDetector')).toBe(false);
  });

  it('blocks trail-blinding selector updates while keeping UpdateTrail', () => {
    // Narrowing event selectors or the event data store is never a fix.
    // UpdateTrail itself stays allowed — it IS the fix, guarded per-parameter.
    expect(isBlockedRemediationAction('cloudtrail:PutEventSelectors')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('cloudtrail:UpdateEventDataStore')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('cloudtrail:UpdateTrail')).toBe(false);
  });

  it('blocks data-send primitives, not just subscription setup', () => {
    // The setup actions were already blocked; the actual senders complete
    // the exfiltration and no documented fix needs them.
    expect(isBlockedRemediationAction('sns:Publish')).toBe(true);
    expect(isBlockedRemediationAction('sqs:SendMessage')).toBe(true);
    expect(isBlockedRemediationAction('events:PutEvents')).toBe(true);
    expect(isBlockedRemediationAction('s3:PutBucketNotification')).toBe(true);
  });

  it('blocks account-wide SSM setting mutation and ENI SG swaps', () => {
    // The validators refuse UpdateServiceSetting wholesale, so a grant here
    // could never serve a legitimate step.
    expect(isBlockedRemediationAction('ssm:UpdateServiceSetting')).toBe(true);
    // Same traffic-rerouting outcome as ModifyInstanceAttribute through the
    // network-interface modifier.
    expect(
      isBlockedRemediationAction('ec2:ModifyNetworkInterfaceAttribute'),
    ).toBe(true);
  });

  it('blocks network-fabric mutation without an Authorize/Delete verb', () => {
    expect(isBlockedRemediationAction('ec2:ModifyInstanceAttribute')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('ec2:CreateRoute')).toBe(true);
    expect(isBlockedRemediationAction('ec2:ReplaceRoute')).toBe(true);
    // Same open-ingress outcome through the modify path — no Authorize verb
    // for the generic rule to catch.
    expect(isBlockedRemediationAction('ec2:ModifySecurityGroupRules')).toBe(
      true,
    );
    expect(
      isBlockedRemediationAction(
        'ec2:UpdateSecurityGroupRuleDescriptionsIngress',
      ),
    ).toBe(true);
    expect(
      isBlockedRemediationAction(
        'ec2:UpdateSecurityGroupRuleDescriptionsEgress',
      ),
    ).toBe(true);
    expect(isBlockedRemediationAction('ec2:ModifyVpcAttribute')).toBe(true);
    expect(isBlockedRemediationAction('ec2:ModifySubnetAttribute')).toBe(true);
  });

  it('blocks code deploy and parameter writes (RCE-shaped, never a fix)', () => {
    expect(isBlockedRemediationAction('lambda:UpdateFunctionCode')).toBe(true);
    expect(isBlockedRemediationAction('ssm:PutParameter')).toBe(true);
  });

  it('blocks snapshot / AMI sharing modifiers (cross-account exfil)', () => {
    expect(isBlockedRemediationAction('rds:ModifyDBSnapshotAttribute')).toBe(
      true,
    );
    expect(
      isBlockedRemediationAction('rds:ModifyDBClusterSnapshotAttribute'),
    ).toBe(true);
    expect(isBlockedRemediationAction('rds:ModifyDBCluster')).toBe(true);
    expect(isBlockedRemediationAction('ec2:ModifySnapshotAttribute')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('ec2:ModifyImageAttribute')).toBe(true);
  });

  it('blocks secret-plaintext reads (values reach DB and model context)', () => {
    expect(isBlockedRemediationAction('secretsmanager:GetSecretValue')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('ssm:GetParameter')).toBe(true);
    expect(isBlockedRemediationAction('ssm:GetParameters')).toBe(true);
    expect(isBlockedRemediationAction('ssm:GetParametersByPath')).toBe(true);
    expect(isBlockedRemediationAction('kms:Decrypt')).toBe(true);
    // Secret writes persist attacker-shaped values through the role.
    // DeleteSecret rides the generic Delete verb; pinned here regardless.
    expect(isBlockedRemediationAction('secretsmanager:PutSecretValue')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('secretsmanager:CreateSecret')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('secretsmanager:UpdateSecret')).toBe(
      true,
    );
    expect(isBlockedRemediationAction('secretsmanager:DeleteSecret')).toBe(
      true,
    );
    // Metadata reads stay allowed — auditors need them, and they carry no
    // secret values.
    expect(isBlockedRemediationAction('secretsmanager:DescribeSecret')).toBe(
      false,
    );
    expect(isBlockedRemediationAction('ssm:GetServiceSetting')).toBe(false);
  });

  it('keeps dual-use fix-mechanism actions allowed (pure primitives are blocked instead)', () => {
    // These ARE the fix for their finding classes — blocking them would end
    // auto-remediation there. See the grouping rule in the actions module.
    expect(isBlockedRemediationAction('cloudtrail:UpdateTrail')).toBe(false);
    expect(isBlockedRemediationAction('config:PutConfigurationRecorder')).toBe(
      false,
    );
  });

  it('blocks wildcards — scripts must name actions', () => {
    expect(isBlockedRemediationAction('s3:*')).toBe(true);
    expect(isBlockedRemediationAction('s3:Get*')).toBe(true);
    expect(isBlockedRemediationAction('*:*')).toBe(true);
    expect(isBlockedRemediationAction('*:GetObject')).toBe(true);
    expect(isBlockedRemediationAction('*')).toBe(true);
  });

  it('matches case-insensitively — IAM evaluates action names either way', () => {
    expect(isBlockedRemediationAction('IAM:PassRole')).toBe(true);
    expect(isBlockedRemediationAction('Iam:CreateRole')).toBe(true);
    expect(isBlockedRemediationAction('iam:passrole')).toBe(true);
    expect(isBlockedRemediationAction('S3:PUTBUCKETPOLICY')).toBe(true);
    expect(isBlockedRemediationAction('CLOUDTRAIL:stopLogging')).toBe(true);
  });

  it('grants safe actions regardless of service-prefix case', () => {
    expect(isBlockedRemediationAction('S3:PutBucketEncryption')).toBe(false);
    expect(isBlockedRemediationAction('s3:PutBucketEncryption')).toBe(false);
  });

  it('blocks padded or malformed tokens instead of letting them through', () => {
    expect(isBlockedRemediationAction(' iam:PassRole')).toBe(true);
    expect(isBlockedRemediationAction('iam:PassRole ')).toBe(true);
    expect(isBlockedRemediationAction('foo')).toBe(true);
    expect(isBlockedRemediationAction('')).toBe(true);
    expect(
      isBlockedRemediationAction('(could not determine specific action)'),
    ).toBe(true);
    expect(isBlockedRemediationAction("s3:PutBucketEncryption'; evil #")).toBe(
      true,
    );
    expect(isBlockedRemediationAction('s3:PutBucketEncryption\nDoEvil')).toBe(
      true,
    );
    expect(isBlockedRemediationAction(null as unknown as string)).toBe(true);
  });

  it('blocks ACL-granting writes but keeps ACL reads for auditors', () => {
    expect(isBlockedRemediationAction('s3:PutBucketAcl')).toBe(true);
    expect(isBlockedRemediationAction('s3:PutObjectAcl')).toBe(true);
    expect(isBlockedRemediationAction('s3:GetBucketAcl')).toBe(false);
  });

  it('blocks sts role chaining except harmless GetCallerIdentity', () => {
    expect(isBlockedRemediationAction('sts:AssumeRole')).toBe(true);
    expect(isBlockedRemediationAction('STS:AssumeRole')).toBe(true);
    expect(isBlockedRemediationAction('sts:AssumeRoleWithSAML')).toBe(true);
    expect(isBlockedRemediationAction('sts:GetCallerIdentity')).toBe(false);
  });

  it('allows fix-forward actions', () => {
    expect(isBlockedRemediationAction('s3:PutBucketEncryption')).toBe(false);
    expect(isBlockedRemediationAction('s3:PutPublicAccessBlock')).toBe(false);
    expect(isBlockedRemediationAction('kms:EnableKeyRotation')).toBe(false);
    expect(isBlockedRemediationAction('cloudtrail:StartLogging')).toBe(false);
    expect(isBlockedRemediationAction('guardduty:CreateDetector')).toBe(false);
    expect(isBlockedRemediationAction('dynamodb:UpdateContinuousBackups')).toBe(
      false,
    );
    expect(isBlockedRemediationAction('logs:PutMetricFilter')).toBe(false);
    expect(isBlockedRemediationAction('cloudwatch:PutMetricAlarm')).toBe(false);
  });
});

describe('formatBlockedActionsForDisplay', () => {
  it('passes canonical actions through unchanged', () => {
    expect(
      formatBlockedActionsForDisplay(['iam:PassRole', 's3:PutBucketPolicy']),
    ).toBe('iam:PassRole, s3:PutBucketPolicy');
  });

  it('neutralizes quotes and newlines so comments stay one line', () => {
    const rendered = formatBlockedActionsForDisplay([
      "s3:PutBucketEncryption'; evil #",
      'iam:PassRole\nDoEvil',
    ]);
    expect(rendered).not.toContain("'");
    expect(rendered).not.toContain('\n');
    expect(rendered).toContain('?');
  });
});

describe('splitBlockedRemediationActions', () => {
  it('dedupes, splits, and sorts both buckets', () => {
    const { allowed, blocked } = splitBlockedRemediationActions([
      'iam:PutRolePolicy',
      's3:PutBucketEncryption',
      's3:PutBucketEncryption',
      'kms:DisableKeyRotation',
      'logs:PutMetricFilter',
    ]);
    expect(allowed).toEqual(['logs:PutMetricFilter', 's3:PutBucketEncryption']);
    expect(blocked).toEqual(['iam:PutRolePolicy', 'kms:DisableKeyRotation']);
  });
});

describe('extractIamActionsFromErrorMessage', () => {
  it('captures hyphenated service names instead of truncating them', () => {
    expect(
      extractIamActionsFromErrorMessage(
        'not authorized to perform: cognito-idp:DescribeUserPool with an explicit deny',
      ),
    ).toEqual(['cognito-idp:DescribeUserPool']);
  });

  it('matches every AWS pattern family', () => {
    expect(
      extractIamActionsFromErrorMessage(
        'you do not have the required iam:CreateServiceLinkedRole permission',
      ),
    ).toEqual(['iam:CreateServiceLinkedRole']);
    expect(
      extractIamActionsFromErrorMessage(
        'Access Denied for action: s3:PutBucketEncryption',
      ),
    ).toEqual(['s3:PutBucketEncryption']);
    expect(
      extractIamActionsFromErrorMessage(
        'UnauthorizedAccess: guardduty:CreateDetector',
      ),
    ).toEqual(['guardduty:CreateDetector']);
  });

  it('dedupes repeated matches and preserves first-seen order', () => {
    expect(
      extractIamActionsFromErrorMessage(
        'not authorized to perform: s3:PutBucketEncryption — not authorized to perform: s3:PutBucketEncryption',
      ),
    ).toEqual(['s3:PutBucketEncryption']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(extractIamActionsFromErrorMessage('Access Denied')).toEqual([]);
    expect(extractIamActionsFromErrorMessage('')).toEqual([]);
  });

  it('skips ARN fragments and timestamps to reach the real action', () => {
    expect(
      extractIamActionsFromErrorMessage(
        'UnauthorizedAccess: arn:aws:iam::123456789012:user/Bob failed guardduty:CreateDetector',
      ),
    ).toEqual(['guardduty:CreateDetector']);
    expect(
      extractIamActionsFromErrorMessage(
        'UnauthorizedAccess at 12:30 while calling guardduty:CreateDetector',
      ),
    ).toEqual(['guardduty:CreateDetector']);
    // The denied branch used to capture the ARN fragment first and return
    // nothing — the uppercase-constrained token skips it like the other
    // branches do.
    expect(
      extractIamActionsFromErrorMessage(
        'Access Denied for arn:aws:iam::123456789012:role/OpenComp-Remediator: s3:PutBucketEncryption required',
      ),
    ).toEqual(['s3:PutBucketEncryption']);
  });

  it('rejects lowercase action slots — AWS emits canonical PascalCase', () => {
    expect(
      extractIamActionsFromErrorMessage(
        'not authorized to perform: s3:putbucketencryption',
      ),
    ).toEqual([]);
    expect(
      extractIamActionsFromErrorMessage('Access Denied for action: 12:30'),
    ).toEqual([]);
  });

  it('stays linear on hostile keyword repetition (ReDoS guard)', () => {
    // Unbounded `.*?` gaps turn these into quadratic backtracking. The
    // bounded gaps above must keep extraction instant — a hang fails the
    // test via the jest timeout instead of hanging CI.
    expect(
      extractIamActionsFromErrorMessage(`denied ${'denied '.repeat(5000)}`),
    ).toEqual([]);
    expect(
      extractIamActionsFromErrorMessage(
        `UnauthorizedAccess${'-'.repeat(5000)}`,
      ),
    ).toEqual([]);
  });
});

function hasShellTools(): boolean {
  try {
    execFileSync('bash', ['-c', 'command -v jq']);
    return true;
  } catch {
    return false;
  }
}

// Runs the generated merge lines end-to-end with a stubbed `aws` CLI.
// Skipped where bash/jq are unavailable (all CI runners ship both).
const describeMerge = hasShellTools() ? describe : describe.skip;

describeMerge('rolePolicyMergeScriptLines', () => {
  function runMerge(opts: {
    livePolicy: Record<string, unknown>;
    newActions: string[];
  }): { Statement: Array<Record<string, unknown>> } {
    const stub = `
      ROLE="r" POLICY="p"
      NEW_ACTIONS='${JSON.stringify(opts.newActions)}'
      LIVE_POLICY='${JSON.stringify(opts.livePolicy)}'
      aws() {
        if [ "$1 $2" = "iam get-role-policy" ]; then printf '%s' "$LIVE_POLICY"; return 0; fi
        if [ "$1 $2" = "iam put-role-policy" ]; then
          while [ $# -gt 0 ]; do
            if [ "$1" = "--policy-document" ]; then printf '%s' "$2"; return 0; fi
            shift
          done
          return 1
        fi
        return 1
      }
      ${rolePolicyMergeScriptLines('NEW_ACTIONS').join('\n')}
    `;
    const out = execFileSync('bash', ['-c', stub], { encoding: 'utf8' });
    return JSON.parse(out) as {
      Statement: Array<Record<string, unknown>>;
    };
  }

  it('never widens a scoped Allow to "*"', () => {
    const { Statement: statements } = runMerge({
      livePolicy: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Deny',
            Action: 's3:DeleteBucket',
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: ['s3:GetObject'],
            Resource: 'arn:aws:s3:::one-bucket/*',
          },
          {
            Effect: 'Allow',
            Action: 'ec2:DescribeInstances',
            Resource: '*',
            Condition: { StringEquals: { a: 'b' } },
          },
          {
            Effect: 'Allow',
            Action: 's3:PutBucketEncryption',
            Resource: '*',
          },
        ],
      },
      newActions: ['s3:PutBucketEncryption'],
    });

    // The scoped Allow survives verbatim on its bucket ARN.
    expect(statements).toContainEqual({
      Effect: 'Allow',
      Action: ['s3:GetObject'],
      Resource: 'arn:aws:s3:::one-bucket/*',
    });
    // No statement grants the scoped action on "*".
    const wildcardActions = statements
      .filter((s) => s.Effect === 'Allow' && s.Resource === '*')
      .flatMap((s) => [s.Action].flat() as string[]);
    expect(wildcardActions).not.toContain('s3:GetObject');
    expect(wildcardActions).toContain('s3:PutBucketEncryption');
    // Deny statements and Conditions survive the merge.
    expect(
      statements.some(
        (s) =>
          s.Effect === 'Deny' &&
          (s.Action as string | string[]).includes('s3:DeleteBucket'),
      ),
    ).toBe(true);
    expect(statements.some((s) => s.Condition !== undefined)).toBe(true);
  });

  it('keeps reruns idempotent — no duplicate grants accumulate', () => {
    const livePolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:PutBucketEncryption'],
          Resource: '*',
        },
      ],
    };
    const first = runMerge({
      livePolicy,
      newActions: ['s3:PutBucketEncryption'],
    });
    const second = runMerge({
      livePolicy: {
        Version: '2012-10-17',
        Statement: first.Statement,
      },
      newActions: ['s3:PutBucketEncryption'],
    });
    expect(second.Statement).toEqual(first.Statement);
  });

  it('passes Allow+NotAction through verbatim instead of dropping it', () => {
    const notActionStatement = {
      Effect: 'Allow',
      NotAction: ['iam:*'],
      Resource: '*',
    };
    const { Statement: statements } = runMerge({
      livePolicy: {
        Version: '2012-10-17',
        Statement: [notActionStatement],
      },
      newActions: ['s3:PutBucketEncryption'],
    });
    // The inverted match cannot be represented in the merged statement, so
    // the original stays untouched — deleting it would widen access.
    expect(statements).toContainEqual(notActionStatement);
  });

  it('passes Allow+NotResource through verbatim instead of widening it', () => {
    const notResourceStatement = {
      Effect: 'Allow',
      Action: 's3:GetObject',
      NotResource: 'arn:aws:s3:::secret-bucket/*',
    };
    const { Statement: statements } = runMerge({
      livePolicy: {
        Version: '2012-10-17',
        Statement: [notResourceStatement],
      },
      newActions: ['s3:PutBucketEncryption'],
    });
    // The carve-out survives, and the action is NOT re-granted on "*".
    expect(statements).toContainEqual(notResourceStatement);
    const wildcardActions = statements
      .filter((s) => s.Effect === 'Allow' && s.Resource === '*')
      .flatMap((s) => [s.Action].flat() as string[]);
    expect(wildcardActions).not.toContain('s3:GetObject');
  });
});
