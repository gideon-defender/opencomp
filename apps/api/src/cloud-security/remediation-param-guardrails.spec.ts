import type { AwsCommandStep } from './ai-remediation.prompt';
import {
  resolveCanonicalCommandName,
  validatePlanSteps,
} from './aws-command-executor';
import { validateFixStepParams } from './remediation-param-guardrails';

function step(overrides: Partial<AwsCommandStep>): AwsCommandStep {
  return {
    service: overrides.service ?? 'sns',
    command: overrides.command ?? 'SetTopicAttributesCommand',
    params: overrides.params ?? {},
    purpose: overrides.purpose ?? 'test step',
  };
}

describe('validateFixStepParams — SNS/SQS resource-policy writes', () => {
  it('refuses SetTopicAttributes that writes the Policy attribute', () => {
    const errors = validateFixStepParams(
      step({ params: { AttributeName: 'Policy', AttributeValue: '{}' } }),
      'Step 1 (SetTopicAttributesCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Policy.*refused for safety/);
  });

  it('matches the Policy attribute name case-insensitively with padding', () => {
    const errors = validateFixStepParams(
      step({ params: { AttributeName: '  policy ' } }),
      'Step 1 (SetTopicAttributesCommand)',
    );
    expect(errors).toHaveLength(1);
  });

  it('allows SetTopicAttributes for non-policy attributes (SSE, delivery policy)', () => {
    for (const name of ['KmsMasterKeyId', 'DeliveryPolicy', 'DisplayName']) {
      const errors = validateFixStepParams(
        step({ params: { AttributeName: name, AttributeValue: 'x' } }),
        'Step 1 (SetTopicAttributesCommand)',
      );
      expect(errors).toEqual([]);
    }
  });

  it('refuses SetQueueAttributes with a Policy key in the Attributes map', () => {
    const errors = validateFixStepParams(
      step({
        service: 'sqs',
        command: 'SetQueueAttributesCommand',
        params: { Attributes: { Policy: '{}', VisibilityTimeout: '30' } },
      }),
      'Step 2 (SetQueueAttributesCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Policy.*refused for safety/);
  });

  it('allows SetQueueAttributes without a Policy key', () => {
    const errors = validateFixStepParams(
      step({
        service: 'sqs',
        command: 'SetQueueAttributesCommand',
        params: { Attributes: { KmsMasterKeyId: 'alias/aws/sqs' } },
      }),
      'Step 1 (SetQueueAttributesCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('ignores unrelated commands', () => {
    const errors = validateFixStepParams(
      step({
        service: 's3',
        command: 'PutBucketEncryptionCommand',
        params: { Bucket: 'b' },
      }),
      'Step 1 (PutBucketEncryptionCommand)',
    );
    expect(errors).toEqual([]);
  });
});

describe('validateFixStepParams — control-weakening flags', () => {
  it('refuses UpdateTrail that explicitly disables hardening flags', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: { Name: 't', EnableLogFileValidation: false },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/EnableLogFileValidation/);
  });

  it('refuses UpdateTrail that drops multi-region coverage', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: { Name: 't', IsMultiRegionTrail: false },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toHaveLength(1);
  });

  it('refuses UpdateTrail that drops global-service events', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: { Name: 't', IncludeGlobalServiceEvents: false },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/IncludeGlobalServiceEvents/);
  });

  it('allows UpdateTrail that enables hardening flags', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: {
          Name: 't',
          EnableLogFileValidation: true,
          IsMultiRegionTrail: true,
        },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses PutConfigurationRecorder that narrows coverage', () => {
    const errors = validateFixStepParams(
      step({
        service: 'config-service',
        command: 'PutConfigurationRecorderCommand',
        params: {
          ConfigurationRecorder: {
            recordingGroup: {
              allSupported: false,
            },
          },
        },
      }),
      'Step 1 (PutConfigurationRecorderCommand)',
    );
    expect(errors).toHaveLength(1);
  });

  it('allows PutConfigurationRecorder that records everything', () => {
    const errors = validateFixStepParams(
      step({
        service: 'config-service',
        command: 'PutConfigurationRecorderCommand',
        params: {
          ConfigurationRecorder: {
            recordingGroup: { allSupported: true },
          },
        },
      }),
      'Step 1 (PutConfigurationRecorderCommand)',
    );
    expect(errors).toEqual([]);
  });
});

describe('validatePlanSteps — param guardrails', () => {
  it('rejects a plan that opens an SNS topic policy', () => {
    const errors = validatePlanSteps([
      step({ params: { AttributeName: 'Policy', AttributeValue: '{}' } }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /Step 1 \(SetTopicAttributesCommand\): writing the "Policy" attribute/,
        ),
      ]),
    );
  });

  it('rejects a plan that replaces an SQS queue policy', () => {
    const errors = validatePlanSteps([
      step({
        service: 'sqs',
        command: 'SetQueueAttributesCommand',
        params: { Attributes: { Policy: '{}' } },
      }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /Step 1 \(SetQueueAttributesCommand\): writing the "Policy" attribute/,
        ),
      ]),
    );
  });

  it('accepts a plan that enables SNS-side SSE via the same command', () => {
    const errors = validatePlanSteps([
      step({
        params: {
          AttributeName: 'KmsMasterKeyId',
          AttributeValue: 'alias/aws/sns',
        },
      }),
    ]);
    expect(errors.filter((e) => e.includes('Policy'))).toHaveLength(0);
  });
});

describe('resolveCanonicalCommandName — single resolution source', () => {
  it('returns the exact name on a direct hit', () => {
    expect(
      resolveCanonicalCommandName('sns', 'SetTopicAttributesCommand'),
    ).toBe('SetTopicAttributesCommand');
  });

  it('resolves a near-miss spelling to the real command', () => {
    expect(resolveCanonicalCommandName('sns', 'SetTopicAttributeCommand')).toBe(
      'SetTopicAttributesCommand',
    );
    expect(
      resolveCanonicalCommandName('cloudtrail', 'UpdateTrailCommands'),
    ).toBe('UpdateTrailCommand');
  });

  it('returns null for unknown services and unknown commands', () => {
    expect(resolveCanonicalCommandName('nope', 'DoCommand')).toBeNull();
    expect(
      resolveCanonicalCommandName('sns', 'DefinitelyNotACommand'),
    ).toBeNull();
  });

  it('returns null for an empty command base instead of matching everything', () => {
    // Every command name contains "" — without this guard a bare
    // "Command" resolves to whatever the module lists first.
    expect(resolveCanonicalCommandName('s3', 'Command')).toBeNull();
  });
});

describe('validatePlanSteps — fuzzy names cannot dodge guardrails', () => {
  it('refuses a Policy write behind a singular (fuzzy) command name', () => {
    const errors = validatePlanSteps([
      step({
        command: 'SetTopicAttributeCommand',
        params: { AttributeName: 'Policy', AttributeValue: '{}' },
      }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/writing the "Policy" attribute/),
      ]),
    );
  });

  it('refuses trail-weakening behind a fuzzy command name', () => {
    const errors = validatePlanSteps([
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommands',
        params: { Name: 't', EnableLogFileValidation: false },
      }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/EnableLogFileValidation/),
      ]),
    );
  });

  it('still blocks a fuzzy spelling of a blocked command', () => {
    const errors = validatePlanSteps([
      step({
        service: 'ec2',
        command: 'TerminateInstanceCommand',
        params: { InstanceIds: ['i-123'] },
      }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
    );
  });
});

describe('validateFixStepParams — public-access-block weakening', () => {
  it('refuses PutPublicAccessBlock with any nested Block flag off', () => {
    for (const flag of [
      'BlockPublicAcls',
      'IgnorePublicAcls',
      'BlockPublicPolicy',
      'RestrictPublicBuckets',
    ]) {
      const errors = validateFixStepParams(
        step({
          service: 's3',
          command: 'PutPublicAccessBlockCommand',
          params: {
            Bucket: 'b',
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              IgnorePublicAcls: true,
              BlockPublicPolicy: true,
              RestrictPublicBuckets: true,
              [flag]: false,
            },
          },
        }),
        'Step 1 (PutPublicAccessBlockCommand)',
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(new RegExp(flag));
    }
  });

  it('refuses PutPublicAccessBlock with a top-level Block flag off', () => {
    const errors = validateFixStepParams(
      step({
        service: 's3',
        command: 'PutPublicAccessBlockCommand',
        params: { Bucket: 'b', BlockPublicAcls: false },
      }),
      'Step 1 (PutPublicAccessBlockCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/BlockPublicAcls/);
  });

  it('allows PutPublicAccessBlock with every nested Block flag on', () => {
    const errors = validateFixStepParams(
      step({
        service: 's3',
        command: 'PutPublicAccessBlockCommand',
        params: {
          Bucket: 'b',
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        },
      }),
      'Step 1 (PutPublicAccessBlockCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses PutPublicAccessBlock with a partial configuration (one flag on, rest omitted)', () => {
    // Replace semantics: omitted flags land as `false` server-side, so a
    // partial config reads like a fix while leaving the bucket public.
    const errors = validateFixStepParams(
      step({
        service: 's3',
        command: 'PutPublicAccessBlockCommand',
        params: {
          Bucket: 'b',
          PublicAccessBlockConfiguration: { BlockPublicAcls: true },
        },
      }),
      'Step 1 (PutPublicAccessBlockCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/all four Block flags/);
  });

  it('refuses PutPublicAccessBlock with no configuration object', () => {
    const errors = validateFixStepParams(
      step({
        service: 's3',
        command: 'PutPublicAccessBlockCommand',
        params: { Bucket: 'b' },
      }),
      'Step 1 (PutPublicAccessBlockCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/all four Block flags/);
  });
});

describe('validateFixStepParams — trail destination redirect', () => {
  it('refuses UpdateTrail that changes the S3 bucket', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: { Name: 't', S3BucketName: 'attacker-bucket' },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/S3BucketName/);
  });

  it('refuses UpdateTrail that re-keys with KmsKeyId', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: { Name: 't', KmsKeyId: 'arn:aws:kms:x:key/y' },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/KmsKeyId/);
  });

  it('allows UpdateTrail that wires the CloudWatch log group (documented fix)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: {
          Name: 't',
          CloudWatchLogsLogGroupArn:
            'arn:aws:logs:us-east-1:123:log-group:trail-logs',
        },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toEqual([]);
  });
});

describe('validateFixStepParams — delivery-channel topic redirect', () => {
  it('refuses PutDeliveryChannel that sets snsTopicARN', () => {
    const errors = validateFixStepParams(
      step({
        service: 'config-service',
        command: 'PutDeliveryChannelCommand',
        params: {
          DeliveryChannel: {
            name: 'opencomp-delivery-channel',
            s3BucketName: 'logs',
            snsTopicARN: 'arn:aws:sns:us-east-1:999:exfil',
          },
        },
      }),
      'Step 1 (PutDeliveryChannelCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/snsTopicARN/);
  });

  it('allows PutDeliveryChannel with only the documented name + bucket', () => {
    const errors = validateFixStepParams(
      step({
        service: 'config-service',
        command: 'PutDeliveryChannelCommand',
        params: {
          DeliveryChannel: {
            name: 'opencomp-delivery-channel',
            s3BucketName: 'logs',
          },
        },
      }),
      'Step 1 (PutDeliveryChannelCommand)',
    );
    expect(errors).toEqual([]);
  });
});

describe('validateFixStepParams — ECR scan disable', () => {
  it('refuses PutImageScanningConfiguration with scanOnPush false', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ecr',
        command: 'PutImageScanningConfigurationCommand',
        params: {
          repositoryName: 'r',
          imageScanningConfiguration: { scanOnPush: false },
        },
      }),
      'Step 1 (PutImageScanningConfigurationCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/scanOnPush/);
  });

  it('allows PutImageScanningConfiguration with scanOnPush true', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ecr',
        command: 'PutImageScanningConfigurationCommand',
        params: {
          repositoryName: 'r',
          imageScanningConfiguration: { scanOnPush: true },
        },
      }),
      'Step 1 (PutImageScanningConfigurationCommand)',
    );
    expect(errors).toEqual([]);
  });
});

describe('validateFixStepParams — recorder inclusion narrowing', () => {
  it('refuses an inclusion-by-resource-types list', () => {
    const errors = validateFixStepParams(
      step({
        service: 'config-service',
        command: 'PutConfigurationRecorderCommand',
        params: {
          ConfigurationRecorder: {
            recordingGroup: {
              recordingStrategy: { useOnly: 'INCLUSION_BY_RESOURCE_TYPES' },
              resourceTypes: ['AWS::EC2::Instance'],
            },
          },
        },
      }),
      'Step 1 (PutConfigurationRecorderCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/narrowing recorder coverage/);
  });

  it('refuses an exclusion-only list (no affirmative full signal)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'config-service',
        command: 'PutConfigurationRecorderCommand',
        params: {
          ConfigurationRecorder: {
            recordingGroup: {
              exclusionByResourceTypes: ['AWS::EC2::Instance'],
            },
          },
        },
      }),
      'Step 1 (PutConfigurationRecorderCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/narrowing recorder coverage/);
  });

  it('refuses an empty recording group (records nothing, fail-closed)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'config-service',
        command: 'PutConfigurationRecorderCommand',
        params: {
          ConfigurationRecorder: {
            recordingGroup: {},
          },
        },
      }),
      'Step 1 (PutConfigurationRecorderCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/narrowing recorder coverage/);
  });

  it('allows allSupported:true alongside exclusions (normalizer collapses it)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'config-service',
        command: 'PutConfigurationRecorderCommand',
        params: {
          ConfigurationRecorder: {
            recordingGroup: {
              allSupported: true,
              exclusionByResourceTypes: ['AWS::IAM::Role'],
            },
          },
        },
      }),
      'Step 1 (PutConfigurationRecorderCommand)',
    );
    expect(errors).toEqual([]);
  });
});

describe('validateFixStepParams — trail notification/role redirect', () => {
  it('refuses UpdateTrail that sets SnsTopicName', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: { Name: 't', SnsTopicName: 'arn:aws:sns:us-east-1:999:exfil' },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/SnsTopicName/);
  });

  it('allows UpdateTrail that wires the CloudWatch role (documented fix)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: {
          Name: 't',
          CloudWatchLogsLogGroupArn:
            'arn:aws:logs:us-east-1:123:log-group:trail-logs',
          CloudWatchLogsRoleArn: 'arn:aws:iam::123:role/CloudTrailToCloudWatch',
        },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('allows UpdateTrail that only flips hardening flags (documented fix)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'cloudtrail',
        command: 'UpdateTrailCommand',
        params: { Name: 't', EnableLogFileValidation: true },
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toEqual([]);
  });
});

describe('validateFixStepParams — security-group open grants', () => {
  it('refuses AuthorizeSecurityGroupIngress open to 0.0.0.0/0', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'AuthorizeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-123',
          IpPermissions: [{ IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
        },
      }),
      'Step 1 (AuthorizeSecurityGroupIngressCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/0\.0\.0\.0\/0.*refused for safety/);
  });

  it('refuses AuthorizeSecurityGroupIngress open to ::/0', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'AuthorizeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-123',
          IpPermissions: [{ Ipv6Ranges: [{ CidrIpv6: '::/0' }] }],
        },
      }),
      'Step 1 (AuthorizeSecurityGroupIngressCommand)',
    );
    expect(errors).toHaveLength(1);
  });

  it('allows AuthorizeSecurityGroupIngress with restricted CIDRs (documented fix)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'AuthorizeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-123',
          IpPermissions: [{ IpRanges: [{ CidrIp: '10.0.0.0/8' }] }],
        },
      }),
      'Step 1 (AuthorizeSecurityGroupIngressCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses AuthorizeSecurityGroupEgress open to the world', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'AuthorizeSecurityGroupEgressCommand',
        params: {
          GroupId: 'sg-123',
          IpPermissions: [{ IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
        },
      }),
      'Step 1 (AuthorizeSecurityGroupEgressCommand)',
    );
    expect(errors).toHaveLength(1);
  });

  it('refuses top-level CidrIp 0.0.0.0/0 without IpPermissions (single-rule shorthand)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'AuthorizeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-123',
          IpProtocol: 'tcp',
          FromPort: 22,
          ToPort: 22,
          CidrIp: '0.0.0.0/0',
        },
      }),
      'Step 1 (AuthorizeSecurityGroupIngressCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/0\.0\.0\.0\/0.*refused for safety/);
  });

  it('refuses top-level CidrIpv6 ::/0 on egress without IpPermissions', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'AuthorizeSecurityGroupEgressCommand',
        params: {
          GroupId: 'sg-123',
          IpProtocol: '-1',
          CidrIpv6: '::/0',
        },
      }),
      'Step 1 (AuthorizeSecurityGroupEgressCommand)',
    );
    expect(errors).toHaveLength(1);
  });

  it('allows top-level restricted CidrIp (single-rule shorthand documented fix)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'AuthorizeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-123',
          IpProtocol: 'tcp',
          FromPort: 443,
          ToPort: 443,
          CidrIp: '10.0.0.0/8',
        },
      }),
      'Step 1 (AuthorizeSecurityGroupIngressCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('allows group-reference authorizes with no CIDR at all', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'AuthorizeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-123',
          SourceSecurityGroupName: 'sg-source',
        },
      }),
      'Step 1 (AuthorizeSecurityGroupIngressCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('allows the open grant when validating a rollback step (baseline restore)', () => {
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'AuthorizeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-123',
          IpPermissions: [{ IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
        },
      }),
      'Step 1 (AuthorizeSecurityGroupIngressCommand)',
      { isRollback: true },
    );
    expect(errors).toEqual([]);
  });

  it('validates RevokeSecurityGroupEgress shape like ingress', () => {
    const missing = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'RevokeSecurityGroupEgressCommand',
        params: {},
      }),
      'Step 1 (RevokeSecurityGroupEgressCommand)',
    );
    expect(missing.some((e) => /SecurityGroupRuleIds/.test(e))).toBe(true);

    const ok = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'RevokeSecurityGroupEgressCommand',
        params: { SecurityGroupRuleIds: ['sgr-0123abc'] },
      }),
      'Step 1 (RevokeSecurityGroupEgressCommand)',
    );
    expect(ok).toEqual([]);
  });

  it('still closes an open rule: revoke with an open CIDR is allowed', () => {
    // Revoking 0.0.0.0/0 removes the finding instead of introducing it.
    const errors = validateFixStepParams(
      step({
        service: 'ec2',
        command: 'RevokeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-123',
          IpPermissions: [{ IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
        },
      }),
      'Step 1 (RevokeSecurityGroupIngressCommand)',
    );
    expect(errors).toEqual([]);
  });
});
