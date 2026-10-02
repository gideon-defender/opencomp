import type { AwsCredentialIdentity } from '@aws-sdk/types';
import type { AwsCommandStep } from './ai-remediation.prompt';
import {
  REQUIRED_PARAMS,
  executePlanSteps,
  looksLikeValidationError,
  normalizeConfigRecordingGroup,
  normalizeMetricFilterTransformations,
  resolveCanonicalCommandName,
  validatePlanSteps,
  validateRollbackSteps,
} from './aws-command-executor';

// executePlanSteps builds real SDK clients — keep the whole real s3 module
// (command resolution and validation depend on it) and swap only the
// client class for one whose send is controllable per test.
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  const sendMock = jest.fn();
  class S3Client {
    send = sendMock;
    destroy = jest.fn();
  }
  return { ...actual, S3Client, __sendMock: sendMock };
});

const s3SendMock = (
  jest.requireMock('@aws-sdk/client-s3') as unknown as {
    __sendMock: jest.Mock;
  }
).__sendMock;

const testCredentials: AwsCredentialIdentity = {
  accessKeyId: 'test',
  secretAccessKey: 'test',
};

function step(overrides: Partial<AwsCommandStep>): AwsCommandStep {
  return {
    service: overrides.service ?? 's3',
    command: overrides.command ?? 'PutBucketVersioningCommand',
    params: overrides.params ?? {},
    purpose: overrides.purpose ?? 'test step',
  };
}

/**
 * Focused tests for the REQUIRED_PARAMS branch added to validatePlanSteps.
 * The non-null-param checks defend against AWS's confusing
 * "Member must not be null" errors by failing fast with a clear message.
 */
describe('validatePlanSteps — REQUIRED_PARAMS', () => {
  it('reports a clear error when CreateServiceLinkedRoleCommand is missing AWSServiceName', () => {
    const errors = validatePlanSteps([
      step({
        service: 'iam',
        command: 'CreateServiceLinkedRoleCommand',
        params: {},
      }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /Step 1 \(CreateServiceLinkedRoleCommand\): Required param "AWSServiceName" is missing or empty/,
        ),
      ]),
    );
  });

  it('reports a clear error when CreateLogGroupCommand is missing logGroupName (CS-787 fail-fast)', () => {
    const errors = validatePlanSteps([
      step({ service: 'logs', command: 'CreateLogGroupCommand', params: {} }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /CreateLogGroupCommand\): Required param "logGroupName" is missing or empty/,
        ),
      ]),
    );
  });

  it('does NOT error when CreateLogGroupCommand has a logGroupName', () => {
    const errors = validatePlanSteps([
      step({
        service: 'logs',
        command: 'CreateLogGroupCommand',
        params: { logGroupName: 'aws-cloudtrail-logs' },
      }),
    ]);
    expect(errors.filter((e) => e.includes('logGroupName'))).toHaveLength(0);
  });

  it('does NOT error when AWSServiceName is populated', () => {
    const errors = validatePlanSteps([
      step({
        service: 'iam',
        command: 'CreateServiceLinkedRoleCommand',
        params: { AWSServiceName: 'config.amazonaws.com' },
      }),
    ]);
    expect(errors.filter((e) => e.includes('AWSServiceName'))).toHaveLength(0);
  });

  it.each(['', null, undefined])(
    'treats %p as missing for required-param checks',
    (badValue) => {
      const errors = validatePlanSteps([
        step({
          service: 'iam',
          command: 'CreateServiceLinkedRoleCommand',
          params: { AWSServiceName: badValue },
        }),
      ]);
      expect(
        errors.some((e) =>
          /Required param "AWSServiceName" is missing or empty/.test(e),
        ),
      ).toBe(true);
    },
  );

  it('reports both missing required params for PutBucketPolicyCommand', () => {
    const errors = validatePlanSteps([
      step({
        service: 's3',
        command: 'PutBucketPolicyCommand',
        params: {},
      }),
    ]);
    expect(
      errors.filter((e) => /Required param "Bucket"/.test(e)),
    ).toHaveLength(1);
    expect(
      errors.filter((e) => /Required param "Policy"/.test(e)),
    ).toHaveLength(1);
  });

  it('requires a group identifier for property-based security-group revoke commands', () => {
    const errors = validatePlanSteps([
      step({
        service: 'ec2',
        command: 'RevokeSecurityGroupIngressCommand',
        params: {
          IpPermissions: [
            {
              IpProtocol: 'tcp',
              FromPort: 22,
              ToPort: 22,
              IpRanges: [{ CidrIp: '0.0.0.0/0' }],
            },
          ],
        },
      }),
    ]);

    expect(errors).toEqual(
      expect.arrayContaining([
        'Step 1 (RevokeSecurityGroupIngressCommand): One of "GroupId" or "GroupName" is required',
      ]),
    );
  });

  it('rejects revoke commands that mix rule IDs with rule properties', () => {
    const errors = validatePlanSteps([
      step({
        service: 'ec2',
        command: 'RevokeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-0123abc',
          SecurityGroupRuleIds: ['sgr-0123abc'],
          IpPermissions: [
            {
              IpProtocol: 'tcp',
              FromPort: 22,
              ToPort: 22,
              IpRanges: [{ CidrIp: '0.0.0.0/0' }],
            },
          ],
        },
      }),
    ]);

    expect(errors).toEqual(
      expect.arrayContaining([
        'Step 1 (RevokeSecurityGroupIngressCommand): SecurityGroupRuleIds cannot be combined with rule property params',
      ]),
    );
  });

  it('requires a rule selector for security-group revoke commands', () => {
    const errors = validatePlanSteps([
      step({
        service: 'ec2',
        command: 'RevokeSecurityGroupIngressCommand',
        params: { GroupId: 'sg-0123abc' },
      }),
    ]);

    expect(errors).toEqual(
      expect.arrayContaining([
        'Step 1 (RevokeSecurityGroupIngressCommand): One of "SecurityGroupRuleIds" or rule property params is required',
      ]),
    );
  });

  it('allows property-based security-group revoke commands when GroupId is present', () => {
    const errors = validatePlanSteps([
      step({
        service: 'ec2',
        command: 'RevokeSecurityGroupIngressCommand',
        params: {
          GroupId: 'sg-0123abc',
          IpPermissions: [
            {
              IpProtocol: 'tcp',
              FromPort: 22,
              ToPort: 22,
              IpRanges: [{ CidrIp: '0.0.0.0/0' }],
            },
          ],
        },
      }),
    ]);

    expect(
      errors.some((e) => /RevokeSecurityGroupIngressCommand/.test(e)),
    ).toBe(false);
  });

  it('allows security-group revoke commands that use SecurityGroupRuleIds only', () => {
    const errors = validatePlanSteps([
      step({
        service: 'ec2',
        command: 'RevokeSecurityGroupIngressCommand',
        params: { SecurityGroupRuleIds: ['sgr-0123abc'] },
      }),
    ]);

    expect(errors.some((e) => /GroupId|GroupName/.test(e))).toBe(false);
  });

  it('treats empty one-of arrays as missing values', () => {
    const errors = validatePlanSteps([
      step({
        service: 'ec2',
        command: 'RevokeSecurityGroupIngressCommand',
        params: { SecurityGroupRuleIds: [] },
      }),
    ]);

    expect(errors).toEqual(
      expect.arrayContaining([
        'Step 1 (RevokeSecurityGroupIngressCommand): One of "SecurityGroupRuleIds" or rule property params is required',
      ]),
    );
  });

  it('does NOT apply required-param checks to commands not in REQUIRED_PARAMS', () => {
    // PutBucketVersioningCommand isn't in REQUIRED_PARAMS — should pass
    // even with no params (the AWS SDK will surface its own errors then).
    const errors = validatePlanSteps([
      step({
        service: 's3',
        command: 'PutBucketVersioningCommand',
        params: {},
      }),
    ]);
    // It might still error on other things (e.g., placeholder check),
    // but it must NOT report a "Required param" error.
    expect(errors.some((e) => /Required param /.test(e))).toBe(false);
  });

  it('does not crash on a step with no params (returns validation errors instead)', () => {
    // AI output can omit params entirely — the placeholder scan must not
    // throw TypeError. Missing required params surface as normal errors.
    const paramLess = step({
      service: 's3',
      command: 'PutBucketVersioningCommand',
    }) as unknown as { service: string; command: string; purpose: string };
    expect(() =>
      validatePlanSteps([
        paramLess as unknown as Parameters<typeof validatePlanSteps>[0][number],
      ]),
    ).not.toThrow();
  });

  it('uses the step index in the error message so customers know which step is broken', () => {
    const errors = validatePlanSteps([
      step({
        service: 's3',
        command: 'PutBucketVersioningCommand',
        params: { Bucket: 'b', VersioningConfiguration: { Status: 'Enabled' } },
      }),
      step({
        service: 'iam',
        command: 'CreateServiceLinkedRoleCommand',
        params: {},
      }),
    ]);
    expect(
      errors.find((e) =>
        e.startsWith('Step 2 (CreateServiceLinkedRoleCommand)'),
      ),
    ).toBeDefined();
  });

  it('exports a REQUIRED_PARAMS map that includes the SLR + Config-recorder bug-report commands', () => {
    expect(REQUIRED_PARAMS.CreateServiceLinkedRoleCommand).toEqual([
      'AWSServiceName',
    ]);
    expect(REQUIRED_PARAMS.PutConfigurationRecorderCommand).toContain(
      'ConfigurationRecorder',
    );
    expect(REQUIRED_PARAMS.StartConfigurationRecorderCommand).toContain(
      'ConfigurationRecorderName',
    );
    expect(REQUIRED_PARAMS.PutDeliveryChannelCommand).toContain(
      'DeliveryChannel',
    );
  });
});

describe('looksLikeValidationError', () => {
  it.each([
    "1 validation error detected: Value at 'aWSServiceName' failed to satisfy constraint: Member must not be null",
    'ValidationException: The Bucket parameter is required',
    'InvalidParameterValue: Value (foo) for parameter X is invalid',
    'Member must not be null',
    'failed to satisfy constraint: Member must have length less than or equal to 64',
    'Missing required parameter Bucket',
    'The request must contain the parameter groupName or groupId',
    'is required',
    'must be a valid ARN',
  ])('detects %p as a validation-class error', (msg) => {
    expect(looksLikeValidationError(msg)).toBe(true);
  });

  it.each([
    'AccessDeniedException: User is not authorized to perform iam:CreateRole',
    'ThrottlingException: Rate exceeded',
    'ResourceNotFoundException: detector not found',
    'NoSuchBucket: The specified bucket does not exist',
    '',
  ])('rejects %p as a non-validation error', (msg) => {
    expect(looksLikeValidationError(msg)).toBe(false);
  });
});

describe('validatePlanSteps — pre-existing behavior preserved', () => {
  it('still reports unknown services', () => {
    const errors = validatePlanSteps([
      step({ service: 'not-a-real-service', command: 'WhateverCommand' }),
    ]);
    expect(
      errors.find((e) => /Unknown service "not-a-real-service"/.test(e)),
    ).toBeDefined();
  });

  it('still reports placeholder values', () => {
    const errors = validatePlanSteps([
      step({
        service: 's3',
        command: 'PutBucketVersioningCommand',
        params: { Bucket: '{{BUCKET_NAME}}' },
      }),
    ]);
    expect(
      errors.find((e) => /Contains placeholder values/.test(e)),
    ).toBeDefined();
  });
});

/**
 * AWS Config recorder: `allSupported:true` is mutually exclusive with
 * `recordingStrategy` / `exclusionByResourceTypes` / `resourceTypes`. The AI
 * (and a customer's existing exclusion-based recorder) frequently echoes those
 * fields back alongside allSupported:true, which AWS rejects with a
 * ValidationException. normalizeConfigRecordingGroup collapses the group to the
 * single valid "record everything (incl. global IAM)" shape.
 */
describe('normalizeConfigRecordingGroup', () => {
  it('strips conflicting fields when an exclusion-based group is converted to all-supported', () => {
    const input: Record<string, unknown> = {
      ConfigurationRecorder: {
        name: 'default',
        roleARN: 'arn:aws:iam::123:role/aws-service-role/config',
        recordingGroup: {
          allSupported: true,
          recordingStrategy: { useOnly: 'EXCLUSION_BY_RESOURCE_TYPES' },
          exclusionByResourceTypes: {
            resourceTypes: ['AWS::IAM::User', 'AWS::IAM::Role'],
          },
        },
      },
    };
    normalizeConfigRecordingGroup(input);
    const recorder = input.ConfigurationRecorder as Record<string, unknown>;
    expect(recorder.recordingGroup).toEqual({
      allSupported: true,
      includeGlobalResourceTypes: true,
    });
    // name + roleARN are preserved untouched.
    expect(recorder.name).toBe('default');
    expect(recorder.roleARN).toBe(
      'arn:aws:iam::123:role/aws-service-role/config',
    );
  });

  it('leaves a pure exclusion strategy untouched (validator refuses it — no silent flip)', () => {
    const recordingGroup = {
      recordingStrategy: { useOnly: 'EXCLUSION_BY_RESOURCE_TYPES' },
      exclusionByResourceTypes: { resourceTypes: ['AWS::IAM::Role'] },
    };
    const input: Record<string, unknown> = {
      ConfigurationRecorder: {
        name: 'default',
        recordingGroup,
      },
    };
    normalizeConfigRecordingGroup(input);
    expect(
      (input.ConfigurationRecorder as Record<string, unknown>).recordingGroup,
    ).toEqual(recordingGroup);
  });

  it('cleans an ALL_SUPPORTED_RESOURCE_TYPES strategy to the minimal valid shape', () => {
    const input: Record<string, unknown> = {
      ConfigurationRecorder: {
        name: 'default',
        recordingGroup: {
          allSupported: true,
          recordingStrategy: { useOnly: 'ALL_SUPPORTED_RESOURCE_TYPES' },
        },
      },
    };
    normalizeConfigRecordingGroup(input);
    expect(
      (input.ConfigurationRecorder as Record<string, unknown>).recordingGroup,
    ).toEqual({ allSupported: true, includeGlobalResourceTypes: true });
  });

  it('leaves an INCLUSION_BY_RESOURCE_TYPES recorder untouched (records only specific types)', () => {
    const recordingGroup = {
      allSupported: false,
      recordingStrategy: { useOnly: 'INCLUSION_BY_RESOURCE_TYPES' },
      resourceTypes: ['AWS::S3::Bucket'],
    };
    const input: Record<string, unknown> = {
      ConfigurationRecorder: { name: 'default', recordingGroup },
    };
    normalizeConfigRecordingGroup(input);
    expect(
      (input.ConfigurationRecorder as Record<string, unknown>).recordingGroup,
    ).toEqual(recordingGroup);
  });

  it('is a no-op when there is no ConfigurationRecorder/recordingGroup', () => {
    const input: Record<string, unknown> = {};
    expect(() => normalizeConfigRecordingGroup(input)).not.toThrow();
    expect(input).toEqual({});

    const input2: Record<string, unknown> = {
      ConfigurationRecorder: { name: 'default' },
    };
    normalizeConfigRecordingGroup(input2);
    expect(input2).toEqual({ ConfigurationRecorder: { name: 'default' } });
  });
});

/**
 * CloudWatch metric filters: `metricTransformations` is a required, non-empty
 * array whose entries' `metricValue` must be a string. The model often emits a
 * single object or a numeric metricValue, which AWS rejects ("metric
 * transformations were not properly provided…") and sends the auto-fix to
 * manual steps. normalizeMetricFilterTransformations coerces the valid shape;
 * REQUIRED_PARAMS catches a truly-missing field before execution.
 */
describe('PutMetricFilterCommand required params + normalization', () => {
  it('enforces the required PutMetricFilter params', () => {
    const errors = validatePlanSteps([
      step({
        service: 'cloudwatch-logs',
        command: 'PutMetricFilterCommand',
        params: { logGroupName: 'lg', filterName: 'fn' }, // missing pattern + transforms
      }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        // filterPattern must be PRESENT (but may be empty), so a missing one is
        // reported via the present-check, not the non-empty REQUIRED_PARAMS one.
        expect.stringMatching(
          /Required param "filterPattern" must be provided/,
        ),
        expect.stringMatching(
          /Required param "metricTransformations" is missing/,
        ),
      ]),
    );
  });

  it('allows an empty filterPattern (AWS accepts "" — it matches all events)', () => {
    const errors = validatePlanSteps([
      step({
        service: 'cloudwatch-logs',
        command: 'PutMetricFilterCommand',
        params: {
          logGroupName: 'lg',
          filterName: 'fn',
          filterPattern: '',
          metricTransformations: [
            {
              metricName: 'm',
              metricNamespace: 'CloudTrailMetrics',
              metricValue: '1',
            },
          ],
        },
      }),
    ]);
    expect(errors.filter((e) => /filterPattern/.test(e))).toHaveLength(0);
  });

  it('does not error when all PutMetricFilter params are present', () => {
    const errors = validatePlanSteps([
      step({
        service: 'cloudwatch-logs',
        command: 'PutMetricFilterCommand',
        params: {
          logGroupName: 'lg',
          filterName: 'fn',
          filterPattern: '{ $.eventName = "X" }',
          metricTransformations: [
            {
              metricName: 'm',
              metricNamespace: 'CloudTrailMetrics',
              metricValue: '1',
            },
          ],
        },
      }),
    ]);
    expect(
      errors.filter((e) => e.includes('PutMetricFilterCommand')),
    ).toHaveLength(0);
  });

  it('wraps a single metricTransformations object in an array', () => {
    const input: Record<string, unknown> = {
      logGroupName: 'lg',
      metricTransformations: {
        metricName: 'm',
        metricNamespace: 'CloudTrailMetrics',
        metricValue: '1',
      },
    };
    normalizeMetricFilterTransformations(input);
    expect(input.metricTransformations).toEqual([
      {
        metricName: 'm',
        metricNamespace: 'CloudTrailMetrics',
        metricValue: '1',
      },
    ]);
  });

  it('coerces a numeric metricValue to a string', () => {
    const input: Record<string, unknown> = {
      metricTransformations: [
        {
          metricName: 'm',
          metricNamespace: 'CloudTrailMetrics',
          metricValue: 1,
        },
      ],
    };
    normalizeMetricFilterTransformations(input);
    expect(input.metricTransformations).toEqual([
      {
        metricName: 'm',
        metricNamespace: 'CloudTrailMetrics',
        metricValue: '1',
      },
    ]);
  });

  it('leaves a well-formed metricTransformations array untouched', () => {
    const good = [
      {
        metricName: 'm',
        metricNamespace: 'CloudTrailMetrics',
        metricValue: '1',
      },
    ];
    const input: Record<string, unknown> = { metricTransformations: good };
    normalizeMetricFilterTransformations(input);
    expect(input.metricTransformations).toEqual(good);
  });

  it('is a no-op when metricTransformations is absent', () => {
    const input: Record<string, unknown> = { logGroupName: 'lg' };
    expect(() => normalizeMetricFilterTransformations(input)).not.toThrow();
    expect(input).toEqual({ logGroupName: 'lg' });
  });
});

describe('validatePlanSteps — canonical required params + IAM blocks + rollback', () => {
  it('applies required-param checks to fuzzy command aliases', () => {
    const errors = validatePlanSteps([
      step({
        service: 'logs',
        command: 'CreateLogGroupsCommand',
        params: {},
      }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Required param "logGroupName" is missing/),
      ]),
    );
  });

  it('rejects short inputs instead of executing a neighboring command', () => {
    // `TopicCommand` is not a real command — it must fail closed, not
    // substring-match `CreateTopicCommand` and run a mutating API.
    expect(resolveCanonicalCommandName('sns', 'TopicCommand')).toBeNull();
    const errors = validatePlanSteps([
      step({ service: 'sns', command: 'TopicCommand', params: {} }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/not found/)]),
    );
  });

  it('keeps near-identical actions distinct instead of Bucket-stripping', () => {
    // `GetAclCommand` is not real; the old resolver stripped `Bucket` and
    // ran `GetBucketAclCommand`. Distinct IAM actions stay distinct.
    expect(resolveCanonicalCommandName('s3', 'GetAclCommand')).toBeNull();
  });

  it('blocks IAM privilege-escalation fix steps', () => {
    for (const command of ['PutRolePolicyCommand', 'CreateRoleCommand']) {
      const errors = validatePlanSteps([
        step({ service: 'iam', command, params: {} }),
      ]);
      expect(errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
      );
    }
  });

  it.each([
    ['cloudtrail', 'StopLoggingCommand'],
    ['cloudtrail', 'DeleteTrailCommand'],
    ['guardduty', 'DeleteDetectorCommand'],
    ['config-service', 'StopConfigurationRecorderCommand'],
    ['kms', 'DisableKeyRotationCommand'],
    ['logs', 'DeleteLogGroupCommand'],
  ])('blocks monitoring kill-switch %s as a fix step', (service, command) => {
    const errors = validatePlanSteps([step({ service, command, params: {} })]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
    );
  });

  it.each([
    ['sns', 'PublishCommand'],
    ['sqs', 'SendMessageCommand'],
    ['eventbridge', 'PutEventsCommand'],
    ['s3', 'PutBucketNotificationConfigurationCommand'],
  ])('blocks data-send primitive %s as a fix step', (service, command) => {
    const errors = validatePlanSteps([step({ service, command, params: {} })]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
    );
  });

  it.each([
    ['cloudtrail', 'StopLoggingCommand'],
    ['guardduty', 'DeleteDetectorCommand'],
  ])(
    'still allows kill-switch %s as a rollback undo step',
    (service, command) => {
      expect(
        validateRollbackSteps([step({ service, command, params: {} })]),
      ).toEqual([]);
    },
  );

  it.each([
    ['s3', 'GetObjectCommand'],
    ['sqs', 'ReceiveMessageCommand'],
    ['logs', 'FilterLogEventsCommand'],
    ['logs', 'GetLogEventsCommand'],
  ])(
    'blocks data-content read %s even on the read path',
    (service, command) => {
      // Preview executes read steps with no acknowledgment gate — content
      // reads would pull customer payloads into the DB and model context.
      const errors = validatePlanSteps([
        step({ service, command, params: {} }),
      ]);
      expect(errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
      );
    },
  );

  it.each([
    ['route-53', 'ChangeResourceRecordSetsCommand'],
    ['elastic-load-balancing-v2', 'ModifyListenerCommand'],
    ['elastic-load-balancing-v2', 'ModifyTargetGroupCommand'],
    ['rds', 'StartExportTaskCommand'],
    ['dynamodb', 'ExportTableToPointInTimeCommand'],
  ])('blocks traffic-reroute/export %s as a fix step', (service, command) => {
    const errors = validatePlanSteps([step({ service, command, params: {} })]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
    );
  });

  it.each([
    ['ssm', 'ResumeSessionCommand'],
    ['secrets-manager', 'PutSecretValueCommand'],
    ['secrets-manager', 'CreateSecretCommand'],
    ['secrets-manager', 'UpdateSecretCommand'],
  ])('blocks always-refused %s as a fix step', (service, command) => {
    const errors = validatePlanSteps([step({ service, command, params: {} })]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
    );
  });

  it.each([
    ['ssm', 'ResumeSessionCommand'],
    ['secrets-manager', 'PutSecretValueCommand'],
    ['secrets-manager', 'CreateSecretCommand'],
    ['secrets-manager', 'UpdateSecretCommand'],
  ])(
    'refuses always-blocked %s even on the rollback path',
    (service, command) => {
      // Rollback restores stored state — it never needs a fresh secret value
      // or an interactive shell, so these stay refused with allowBlocked.
      expect(
        validateRollbackSteps([step({ service, command, params: {} })]),
      ).toEqual(
        expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
      );
    },
  );

  it.each([
    ['wafv2', 'DisassociateWebACLCommand'],
    ['ec2', 'DetachVolumeCommand'],
    ['ec2', 'DetachInternetGatewayCommand'],
    ['ec2', 'StartInstancesCommand'],
    ['elastic-load-balancing-v2', 'CreateListenerCommand'],
    ['elastic-load-balancing-v2', 'CreateTargetGroupCommand'],
    ['elastic-load-balancing-v2', 'RegisterTargetsCommand'],
  ])('blocks detach/compute/create %s as a fix step', (service, command) => {
    const errors = validatePlanSteps([step({ service, command, params: {} })]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
    );
  });

  it('validates rollback steps without the blocked-command refusal', () => {
    // A delete rollback is allowed through the blocked gate …
    expect(
      validateRollbackSteps([
        step({
          service: 's3',
          command: 'DeleteBucketCommand',
          params: { Bucket: 'b' },
        }),
      ]),
    ).toEqual([]);
    // … but unknown commands and placeholders still fail.
    expect(
      validateRollbackSteps([
        step({ service: 's3', command: 'NopeCommand', params: {} }),
      ]),
    ).not.toEqual([]);
    expect(
      validateRollbackSteps([
        step({
          service: 's3',
          command: 'DeleteBucketCommand',
          params: { Bucket: '{{BUCKET}}' },
        }),
      ]),
    ).not.toEqual([]);
  });
});

describe('validatePlanSteps — malformed model output fails closed', () => {
  it('rejects a null step instead of throwing', () => {
    expect(() =>
      validatePlanSteps([null as unknown as AwsCommandStep]),
    ).not.toThrow();
    expect(validatePlanSteps([null as unknown as AwsCommandStep])).toEqual(
      expect.arrayContaining([expect.stringMatching(/malformed step/)]),
    );
  });

  it('rejects a step with a missing command instead of throwing', () => {
    const malformed = {
      service: 's3',
      params: {},
      purpose: 'broken model output',
    } as unknown as AwsCommandStep;
    expect(() => validatePlanSteps([malformed])).not.toThrow();
    expect(validatePlanSteps([malformed])).toEqual(
      expect.arrayContaining([expect.stringMatching(/not found/)]),
    );
  });

  it('rejects a non-string service instead of throwing', () => {
    const malformed = step({}) as unknown as Record<string, unknown>;
    malformed['service'] = null;
    expect(() =>
      validatePlanSteps([malformed as unknown as AwsCommandStep]),
    ).not.toThrow();
    expect(validatePlanSteps([malformed as unknown as AwsCommandStep])).toEqual(
      expect.arrayContaining([expect.stringMatching(/Unknown service/)]),
    );
  });

  it('rejects a non-array plan instead of throwing', () => {
    expect(() =>
      validatePlanSteps(null as unknown as AwsCommandStep[]),
    ).not.toThrow();
    expect(validatePlanSteps(null as unknown as AwsCommandStep[])).toEqual(
      expect.arrayContaining([expect.stringMatching(/malformed/)]),
    );
  });

  it('returns null for non-string command names', () => {
    expect(
      resolveCanonicalCommandName('s3', null as unknown as string),
    ).toBeNull();
    expect(
      resolveCanonicalCommandName('s3', undefined as unknown as string),
    ).toBeNull();
  });
});

describe('executePlanSteps — auto-rollback failure surfacing', () => {
  const fixStepOne = step({
    service: 's3',
    command: 'PutBucketVersioningCommand',
    params: {
      Bucket: 'b',
      VersioningConfiguration: { Status: 'Enabled' },
    },
  });
  const fixStepTwo = step({
    service: 's3',
    command: 'PutBucketVersioningCommand',
    params: {
      Bucket: 'c',
      VersioningConfiguration: { Status: 'Enabled' },
    },
  });
  const rollbackStep = step({
    service: 's3',
    command: 'DeleteBucketCommand',
    params: { Bucket: 'b' },
  });

  beforeEach(() => {
    s3SendMock.mockReset();
  });

  it('records rollbackError when auto-rollback fails after a fix failure', async () => {
    s3SendMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        Object.assign(new Error('InternalError: step 2 failed'), {
          name: 'InternalError',
        }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('AccessDenied: cannot delete bucket'), {
          name: 'AccessDenied',
        }),
      );

    const result = await executePlanSteps({
      steps: [fixStepOne, fixStepTwo],
      credentials: testCredentials,
      region: 'us-east-1',
      // Index-paired: rollbackSteps[i] undoes fixSteps[i].
      autoRollbackSteps: [rollbackStep, rollbackStep],
    });

    expect(result.error?.stepIndex).toBe(1);
    // The original step error is preserved and the rollback failure rides
    // along — the caller must warn about partial state.
    expect(result.error?.message).toBe('InternalError: step 2 failed');
    expect(result.rollbackError).toBe('AccessDenied: cannot delete bucket');
  });

  it('leaves rollbackError unset when auto-rollback succeeds', async () => {
    s3SendMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        Object.assign(new Error('InternalError: step 2 failed'), {
          name: 'InternalError',
        }),
      )
      .mockResolvedValueOnce({});

    const result = await executePlanSteps({
      steps: [fixStepOne, fixStepTwo],
      credentials: testCredentials,
      region: 'us-east-1',
      autoRollbackSteps: [rollbackStep, rollbackStep],
    });

    expect(result.error?.stepIndex).toBe(1);
    expect(result.rollbackError).toBeUndefined();
  });

  it('skips auto-rollback when rollback steps cannot be paired by index', async () => {
    s3SendMock.mockReset();
    s3SendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(
      Object.assign(new Error('InternalError: step 2 failed'), {
        name: 'InternalError',
      }),
    );

    const result = await executePlanSteps({
      steps: [fixStepOne, fixStepTwo],
      credentials: testCredentials,
      region: 'us-east-1',
      // One undo step for two fix steps — unpairable, so no undo may run.
      autoRollbackSteps: [rollbackStep],
    });

    expect(result.error?.stepIndex).toBe(1);
    expect(result.error?.message).toBe('InternalError: step 2 failed');
    // No rollback attempted: exactly the two fix-step SDK calls happened.
    expect(s3SendMock).toHaveBeenCalledTimes(2);
    expect(result.rollbackError).toBeUndefined();
    expect(result.rollbackSkipped).toMatch(/cannot pair undo steps safely/);
  });

  it('leaves rollbackError unset without auto-rollback steps', async () => {
    s3SendMock.mockRejectedValueOnce(
      Object.assign(new Error('InternalError: step 1 failed'), {
        name: 'InternalError',
      }),
    );

    const result = await executePlanSteps({
      steps: [fixStepOne],
      credentials: testCredentials,
      region: 'us-east-1',
    });

    expect(result.error?.stepIndex).toBe(0);
    expect(result.rollbackError).toBeUndefined();
    expect(result.rollbackSkipped).toBeUndefined();
  });
});

describe('executePlanSteps — idempotent already-exists error names', () => {
  beforeEach(() => {
    s3SendMock.mockReset();
  });

  // Matching is driven by the SDK v3 `err.name` (exception class names),
  // not the service — so the s3 mock stands in for every service here.
  it.each([
    'EntityAlreadyExistsException',
    'EntityAlreadyExists',
    'TrailAlreadyExistsException',
    'BucketAlreadyOwnedByYou',
    'ResourceAlreadyExistsException',
  ])('treats %s as a no-op success', async (name) => {
    s3SendMock.mockRejectedValueOnce(
      Object.assign(new Error(`${name}: resource already exists`), { name }),
    );

    const result = await executePlanSteps({
      steps: [
        step({
          service: 's3',
          command: 'PutBucketVersioningCommand',
          params: {
            Bucket: 'b',
            VersioningConfiguration: { Status: 'Enabled' },
          },
        }),
      ],
      credentials: testCredentials,
      region: 'us-east-1',
    });

    expect(result.error).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].output._alreadyExists).toBe(true);
  });

  it('keeps a foreign-owned BucketAlreadyExists fatal', async () => {
    s3SendMock.mockRejectedValueOnce(
      Object.assign(new Error('The requested bucket name is not available'), {
        name: 'BucketAlreadyExists',
      }),
    );

    const result = await executePlanSteps({
      steps: [
        step({
          service: 's3',
          command: 'PutBucketVersioningCommand',
          params: {
            Bucket: 'someone-elses-bucket',
            VersioningConfiguration: { Status: 'Enabled' },
          },
        }),
      ],
      credentials: testCredentials,
      region: 'us-east-1',
    });

    expect(result.error).toBeDefined();
    expect(result.results).toHaveLength(0);
  });
});

describe('executePlanSteps — post-no-op skip stays narrow', () => {
  const versioningStep = (bucket: string) =>
    step({
      service: 's3',
      command: 'PutBucketVersioningCommand',
      params: {
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      },
    });

  function mockNoOpThenFailure(failure: Error) {
    let calls = 0;
    s3SendMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(
          Object.assign(new Error('BucketAlreadyOwnedByYou: owned'), {
            name: 'BucketAlreadyOwnedByYou',
          }),
        );
      }
      return Promise.reject(failure);
    });
  }

  beforeEach(() => {
    s3SendMock.mockReset();
  });

  it('still skips a missing-dependency failure after a same-service no-op', async () => {
    mockNoOpThenFailure(
      Object.assign(
        new Error('NoSuchBucket: the specified bucket does not exist'),
        { name: 'NoSuchBucket' },
      ),
    );

    const result = await executePlanSteps({
      steps: [versioningStep('owned-bucket'), versioningStep('owned-bucket')],
      credentials: testCredentials,
      region: 'us-east-1',
    });

    expect(result.error).toBeUndefined();
    expect(result.results[1].output._skipped).toBe(true);
  });

  it('keeps a malformed step fatal after a same-service no-op', async () => {
    mockNoOpThenFailure(
      Object.assign(
        new Error('Invalid parameter: Bucket must be a valid bucket name'),
        { name: 'InvalidParameter' },
      ),
    );

    const result = await executePlanSteps({
      steps: [versioningStep('owned-bucket'), versioningStep('owned-bucket')],
      credentials: testCredentials,
      region: 'us-east-1',
    });

    // A broken step is an AI bug, not a missing dependency — the run must
    // fail loudly instead of reporting skipped progress.
    expect(result.error).toBeDefined();
    expect(result.results.some((r) => r.output._skipped === true)).toBe(false);
  });

  it('stays fatal when the missing resource name differs from the no-op step', async () => {
    mockNoOpThenFailure(
      Object.assign(
        new Error('NoSuchBucket: the specified bucket does not exist'),
        { name: 'NoSuchBucket' },
      ),
    );

    const result = await executePlanSteps({
      steps: [versioningStep('owned-bucket'), versioningStep('other-bucket')],
      credentials: testCredentials,
      region: 'us-east-1',
    });

    // Same service, but nothing names `other-bucket` except the failing
    // step — a typo, not a missing no-op output. The run must fail loudly.
    // (`Enabled` is shared and proves nothing: it is a status flag, not an
    // identifier, so it must not qualify the skip.)
    expect(result.error).toBeDefined();
    expect(result.results.some((r) => r.output._skipped === true)).toBe(false);
  });

  it('does not let a skipped step bless the next skip', async () => {
    let calls = 0;
    s3SendMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(
          Object.assign(new Error('BucketAlreadyOwnedByYou: owned'), {
            name: 'BucketAlreadyOwnedByYou',
          }),
        );
      }
      return Promise.reject(
        Object.assign(
          new Error('NoSuchBucket: the specified bucket does not exist'),
          { name: 'NoSuchBucket' },
        ),
      );
    });

    const result = await executePlanSteps({
      steps: [
        versioningStep('owned-bucket'),
        versioningStep('owned-bucket'),
        versioningStep('third-bucket'),
      ],
      credentials: testCredentials,
      region: 'us-east-1',
    });

    // Step 2 skips legitimately (same bucket as the no-op). Step 3 names a
    // bucket neither prior step used — the `_skipped` in results must not
    // qualify it, so the run fails loudly instead of chaining false success.
    expect(result.error).toBeDefined();
    expect(result.error?.stepIndex).toBe(2);
    expect(result.results[1].output._skipped).toBe(true);
  });
});

describe('rollback path — IAM privilege-escalation stays blocked', () => {
  it.each([
    'PutRolePolicyCommand',
    'CreateRoleCommand',
    'AttachRolePolicyCommand',
  ])('refuses %s in validateRollbackSteps', (command) => {
    const errors = validateRollbackSteps([
      step({ service: 'iam', command, params: {} }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
    );
  });

  it('still allows delete undo steps in validateRollbackSteps', () => {
    expect(
      validateRollbackSteps([
        step({
          service: 's3',
          command: 'DeleteBucketCommand',
          params: { Bucket: 'b' },
        }),
      ]),
    ).toEqual([]);
  });

  it('allows an open-CIDR re-authorize as rollback but refuses it as a fix', () => {
    // The documented SG rollback restores the original open rule — the
    // customer's own pre-fix baseline. Refusing it would make every
    // security-group plan fail validation and degrade to manual steps.
    const rollback = step({
      service: 'ec2',
      command: 'AuthorizeSecurityGroupIngressCommand',
      params: {
        GroupId: 'sg-123',
        IpPermissions: [{ IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
      },
    });
    expect(validateRollbackSteps([rollback])).toEqual([]);
    expect(validatePlanSteps([rollback])).toEqual(
      expect.arrayContaining([expect.stringMatching(/refused for safety/)]),
    );
  });

  it.each([
    { service: 'secretsmanager', command: 'GetSecretValueCommand' },
    { service: 'ssm', command: 'GetParameterCommand' },
    { service: 'ssm', command: 'GetParametersCommand' },
    { service: 'ssm', command: 'GetParametersByPathCommand' },
    { service: 'kms', command: 'DecryptCommand' },
  ])(
    'refuses secret-plaintext read $command on fix and rollback paths',
    ({ service, command }) => {
      for (const errors of [
        validatePlanSteps([step({ service, command, params: {} })]),
        validateRollbackSteps([step({ service, command, params: {} })]),
      ]) {
        expect(errors).toEqual(
          expect.arrayContaining([expect.stringMatching(/blocked for safety/)]),
        );
      }
    },
  );

  it('refuses IAM writes at execution time even with isRollback', async () => {
    s3SendMock.mockReset();
    s3SendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(
      Object.assign(new Error('InternalError: step 2 failed'), {
        name: 'InternalError',
      }),
    );

    const versioned = (bucket: string): AwsCommandStep =>
      step({
        service: 's3',
        command: 'PutBucketVersioningCommand',
        params: {
          Bucket: bucket,
          VersioningConfiguration: { Status: 'Enabled' },
        },
      });

    const result = await executePlanSteps({
      steps: [versioned('b'), versioned('c')],
      credentials: testCredentials,
      region: 'us-east-1',
      autoRollbackSteps: [
        step({
          service: 'iam',
          command: 'PutRolePolicyCommand',
          params: {
            RoleName: 'r',
            PolicyName: 'p',
            PolicyDocument: '{}',
          },
        }),
        step({
          service: 'iam',
          command: 'CreateRoleCommand',
          params: { RoleName: 'r2' },
        }),
      ],
    });

    expect(result.error?.stepIndex).toBe(1);
    expect(result.rollbackError).toMatch(/blocked for safety/);
  });
});

describe('executePlanSteps — AI repair safety gate runs full validation', () => {
  const fixStep = step({
    service: 's3',
    command: 'PutBucketVersioningCommand',
    params: {
      Bucket: 'b',
      VersioningConfiguration: { Status: 'Enabled' },
    },
  });

  beforeEach(() => {
    s3SendMock.mockReset();
  });

  function validationFailure() {
    // Validation-class error the rules-based auto-fix cannot handle (no
    // "Value at 'x'" shape), so the AI repair callback fires.
    s3SendMock.mockRejectedValueOnce(
      Object.assign(
        new Error('ValidationException: request failed validation'),
        { name: 'ValidationException' },
      ),
    );
  }

  it('refuses a repaired step that smuggles in a blocked command', async () => {
    validationFailure();

    const result = await executePlanSteps({
      steps: [fixStep],
      credentials: testCredentials,
      region: 'us-east-1',
      repairStep: async ({ step: failed }) => ({
        ...failed,
        command: 'DeleteBucketCommand',
        params: { Bucket: 'b' },
      }),
    });

    expect(result.error?.stepIndex).toBe(0);
    expect(result.error?.message).toMatch(/blocked for safety/);
    // Refused before retry: the SDK ran exactly once.
    expect(s3SendMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a repaired step that drops a required param', async () => {
    const policyStep = step({
      service: 's3',
      command: 'PutBucketPolicyCommand',
      params: { Bucket: 'b', Policy: '{}' },
    });
    s3SendMock.mockRejectedValueOnce(
      Object.assign(
        new Error('ValidationException: request failed validation'),
        { name: 'ValidationException' },
      ),
    );

    const result = await executePlanSteps({
      steps: [policyStep],
      credentials: testCredentials,
      region: 'us-east-1',
      repairStep: async ({ step: failed }) => ({
        ...failed,
        params: { Policy: '{}' },
      }),
    });

    expect(result.error?.message).toMatch(/Required param "Bucket"/);
    expect(s3SendMock).toHaveBeenCalledTimes(1);
  });

  it('retries a repaired step that clears full validation', async () => {
    s3SendMock
      .mockRejectedValueOnce(
        Object.assign(
          new Error('ValidationException: request failed validation'),
          { name: 'ValidationException' },
        ),
      )
      .mockResolvedValueOnce({ VersioningConfiguration: {} });

    const result = await executePlanSteps({
      steps: [fixStep],
      credentials: testCredentials,
      region: 'us-east-1',
      repairStep: async ({ step: failed }) => ({
        ...failed,
        params: {
          ...failed.params,
          // Genuinely changed (not just reshaped): the unchanged-params
          // case counts as "cannot repair" and never retries.
          ExpectedBucketOwner: '123456789012',
        },
      }),
    });

    expect(result.error).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(s3SendMock).toHaveBeenCalledTimes(2);
  });
});
