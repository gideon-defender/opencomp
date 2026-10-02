import type { AwsCommandStep } from './ai-remediation.prompt';
import { validateFixStepParams } from './remediation-param-guardrails';

function step(
  service: string,
  command: string,
  params: Record<string, unknown>,
): AwsCommandStep {
  return { service, command, params, purpose: 'test step' };
}

describe('validateFixStepParams — documented-rollback shapes', () => {
  it('refuses PutBucketVersioning that suspends versioning', () => {
    const errors = validateFixStepParams(
      step('s3', 'PutBucketVersioningCommand', {
        Bucket: 'b',
        VersioningConfiguration: { Status: 'Suspended' },
      }),
      'Step 1 (PutBucketVersioningCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Suspended.*refused for safety/);
  });

  it('allows PutBucketVersioning that enables versioning', () => {
    const errors = validateFixStepParams(
      step('s3', 'PutBucketVersioningCommand', {
        Bucket: 'b',
        VersioningConfiguration: { Status: 'Enabled' },
      }),
      'Step 1 (PutBucketVersioningCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses UpdateContinuousBackups that disables PITR', () => {
    const errors = validateFixStepParams(
      step('dynamodb', 'UpdateContinuousBackupsCommand', {
        TableName: 't',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: false,
        },
      }),
      'Step 1 (UpdateContinuousBackupsCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/point-in-time recovery.*refused for safety/);
  });

  it('allows UpdateContinuousBackups that enables PITR', () => {
    const errors = validateFixStepParams(
      step('dynamodb', 'UpdateContinuousBackupsCommand', {
        TableName: 't',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      }),
      'Step 1 (UpdateContinuousBackupsCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses PutImageTagMutability that is not IMMUTABLE', () => {
    for (const mutability of ['MUTABLE', 'mutable']) {
      const errors = validateFixStepParams(
        step('ecr', 'PutImageTagMutabilityCommand', {
          repositoryName: 'r',
          imageTagMutability: mutability,
        }),
        'Step 1 (PutImageTagMutabilityCommand)',
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/IMMUTABLE.*refused for safety/);
    }
  });

  it('allows PutImageTagMutability set to IMMUTABLE', () => {
    const errors = validateFixStepParams(
      step('ecr', 'PutImageTagMutabilityCommand', {
        repositoryName: 'r',
        imageTagMutability: 'IMMUTABLE',
      }),
      'Step 1 (PutImageTagMutabilityCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses SetTerminationProtection that disables protection', () => {
    const errors = validateFixStepParams(
      step('emr', 'SetTerminationProtectionCommand', {
        JobFlowIds: ['j-123'],
        TerminationProtected: false,
      }),
      'Step 1 (SetTerminationProtectionCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/termination protection.*refused for safety/);
  });

  it('allows SetTerminationProtection that enables protection', () => {
    const errors = validateFixStepParams(
      step('emr', 'SetTerminationProtectionCommand', {
        JobFlowIds: ['j-123'],
        TerminationProtected: true,
      }),
      'Step 1 (SetTerminationProtectionCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses every UpdateServiceSetting shape', () => {
    const errors = validateFixStepParams(
      step('ssm', 'UpdateServiceSettingCommand', {
        SettingId: '/ssm/documents/console/public-sharing-permission',
        SettingValue: 'Disable',
      }),
      'Step 1 (UpdateServiceSettingCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/never the documented fix.*refused for safety/);
  });

  it('refuses UpdateDetector that disables the detector', () => {
    // Disable-via-update carries no Delete/Disable/Stop verb — the generic
    // rules cannot catch it, so this case must.
    const errors = validateFixStepParams(
      step('guardduty', 'UpdateDetectorCommand', {
        DetectorId: 'd-123',
        Enable: false,
      }),
      'Step 1 (UpdateDetectorCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Enable: false.*refused for safety/);
  });

  it('allows UpdateDetector that leaves Enable untouched', () => {
    for (const params of [
      { DetectorId: 'd-123', FindingPublishingFrequency: 'FIFTEEN_MINUTES' },
      { DetectorId: 'd-123', Enable: true },
      { DetectorId: 'd-123' },
    ]) {
      expect(
        validateFixStepParams(
          step('guardduty', 'UpdateDetectorCommand', params),
          'Step 1 (UpdateDetectorCommand)',
        ),
      ).toEqual([]);
    }
  });

  it('refuses UpdateRoute that removes authorization', () => {
    for (const authType of ['NONE', 'none']) {
      const errors = validateFixStepParams(
        step('apigatewayv2', 'UpdateRouteCommand', {
          ApiId: 'a',
          RouteId: 'r',
          AuthorizationType: authType,
        }),
        'Step 1 (UpdateRouteCommand)',
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/NONE.*refused for safety/);
    }
  });

  it('allows UpdateRoute that attaches an authorizer', () => {
    const errors = validateFixStepParams(
      step('apigatewayv2', 'UpdateRouteCommand', {
        ApiId: 'a',
        RouteId: 'r',
        AuthorizationType: 'JWT',
        AuthorizerId: 'auth',
      }),
      'Step 1 (UpdateRouteCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses UpdateStage with access logging but no destination', () => {
    for (const settings of [{}, { Format: '{}' }, { DestinationArn: '  ' }]) {
      const errors = validateFixStepParams(
        step('apigatewayv2', 'UpdateStageCommand', {
          ApiId: 'a',
          StageName: 's',
          AccessLogSettings: settings,
        }),
        'Step 1 (UpdateStageCommand)',
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(
        /without a log destination.*refused for safety/,
      );
    }
  });

  it('allows UpdateStage that wires a log destination', () => {
    const errors = validateFixStepParams(
      step('apigatewayv2', 'UpdateStageCommand', {
        ApiId: 'a',
        StageName: 's',
        AccessLogSettings: {
          DestinationArn: 'arn:aws:logs:us-east-1:123:log-group:g',
          Format: '{}',
        },
      }),
      'Step 1 (UpdateStageCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('allows UpdateStage that leaves access logging untouched', () => {
    const errors = validateFixStepParams(
      step('apigatewayv2', 'UpdateStageCommand', {
        ApiId: 'a',
        StageName: 's',
        AutoDeploy: true,
      }),
      'Step 1 (UpdateStageCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses UpdateTrail that empties the log-group ARN', () => {
    const errors = validateFixStepParams(
      step('cloudtrail', 'UpdateTrailCommand', {
        Name: 't',
        CloudWatchLogsLogGroupArn: '',
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/CloudWatchLogsLogGroupArn.*refused for safety/);
  });

  it('allows UpdateTrail that sets a log-group ARN', () => {
    const errors = validateFixStepParams(
      step('cloudtrail', 'UpdateTrailCommand', {
        Name: 't',
        CloudWatchLogsLogGroupArn: 'arn:aws:logs:us-east-1:123:log-group:g',
      }),
      'Step 1 (UpdateTrailCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses UpdateLoggingConfiguration that empties log destinations', () => {
    for (const config of [
      { LogDestinationConfigs: [] },
      { LogDestinationConfigs: [{ LogType: 'FLOW', LogDestination: '  ' }] },
    ]) {
      const errors = validateFixStepParams(
        step('network-firewall', 'UpdateLoggingConfigurationCommand', {
          FirewallArn: 'arn',
          LoggingConfiguration: config,
        }),
        'Step 1 (UpdateLoggingConfigurationCommand)',
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/log delivery.*refused for safety/);
    }
  });

  it('allows UpdateLoggingConfiguration that attaches a destination', () => {
    const errors = validateFixStepParams(
      step('network-firewall', 'UpdateLoggingConfigurationCommand', {
        FirewallArn: 'arn',
        LoggingConfiguration: {
          LogDestinationConfigs: [
            {
              LogType: 'FLOW',
              LogDestinationType: 'CloudWatchLogs',
              LogDestination: 'arn:aws:logs:us-east-1:123:log-group:g',
            },
          ],
        },
      }),
      'Step 1 (UpdateLoggingConfigurationCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses SetTopicAttributes that empties the SSE key', () => {
    const errors = validateFixStepParams(
      step('sns', 'SetTopicAttributesCommand', {
        TopicArn: 'arn',
        AttributeName: 'KmsMasterKeyId',
        AttributeValue: '',
      }),
      'Step 1 (SetTopicAttributesCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/KmsMasterKeyId.*refused for safety/);
  });

  it('allows SetTopicAttributes that sets the SSE key', () => {
    const errors = validateFixStepParams(
      step('sns', 'SetTopicAttributesCommand', {
        TopicArn: 'arn',
        AttributeName: 'KmsMasterKeyId',
        AttributeValue: 'alias/aws/sns',
      }),
      'Step 1 (SetTopicAttributesCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('refuses SetQueueAttributes with an emptied SSE key', () => {
    const errors = validateFixStepParams(
      step('sqs', 'SetQueueAttributesCommand', {
        QueueUrl: 'url',
        Attributes: { KmsMasterKeyId: '' },
      }),
      'Step 1 (SetQueueAttributesCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/KmsMasterKeyId.*refused for safety/);
  });

  it('allows SetQueueAttributes with the SSE key set', () => {
    const errors = validateFixStepParams(
      step('sqs', 'SetQueueAttributesCommand', {
        QueueUrl: 'url',
        Attributes: { KmsMasterKeyId: 'alias/aws/sqs' },
      }),
      'Step 1 (SetQueueAttributesCommand)',
    );
    expect(errors).toEqual([]);
  });
});

describe('validateFixStepParams — detector creation must enable detection', () => {
  it('refuses CreateDetector with Enable: false', () => {
    const errors = validateFixStepParams(
      step('guardduty', 'CreateDetectorCommand', { Enable: false }),
      'Step 1 (CreateDetectorCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Enable: false.*refused for safety/);
  });

  it('allows CreateDetector with Enable: true', () => {
    const errors = validateFixStepParams(
      step('guardduty', 'CreateDetectorCommand', { Enable: true }),
      'Step 1 (CreateDetectorCommand)',
    );
    expect(errors).toEqual([]);
  });

  it('allows CreateDetector without Enable (API default is enabled)', () => {
    const errors = validateFixStepParams(
      step('guardduty', 'CreateDetectorCommand', {}),
      'Step 1 (CreateDetectorCommand)',
    );
    expect(errors).toEqual([]);
  });
});

describe('validateFixStepParams — stage execution-logging opt-out', () => {
  it('refuses UpdateStage that turns default route logging OFF', () => {
    const errors = validateFixStepParams(
      step('apigateway', 'UpdateStageCommand', {
        ApiId: 'a',
        StageName: 'prod',
        DefaultRouteSettings: { LoggingLevel: 'OFF' },
      }),
      'Step 1 (UpdateStageCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/route logging "OFF".*refused for safety/);
  });

  it('refuses UpdateStage that turns per-route logging OFF', () => {
    const errors = validateFixStepParams(
      step('apigateway', 'UpdateStageCommand', {
        ApiId: 'a',
        StageName: 'prod',
        RouteSettings: { 'GET /items': { LoggingLevel: 'off' } },
      }),
      'Step 1 (UpdateStageCommand)',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/route logging "OFF".*refused for safety/);
  });

  it('allows UpdateStage that touches unrelated stage settings', () => {
    const errors = validateFixStepParams(
      step('apigateway', 'UpdateStageCommand', {
        ApiId: 'a',
        StageName: 'prod',
        Description: 'docs update',
        DefaultRouteSettings: { LoggingLevel: 'INFO' },
      }),
      'Step 1 (UpdateStageCommand)',
    );
    expect(errors).toEqual([]);
  });
});
