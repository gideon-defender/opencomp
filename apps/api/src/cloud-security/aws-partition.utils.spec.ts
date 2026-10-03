import {
  getAwsBaseCredentials,
  getAwsDefaultRegion,
  getAwsPartitionForRegion,
  hasRemediationRole,
  isValidRemediationRoleName,
  parseAwsRoleArn,
  validateAwsPartitionConfig,
} from './aws-partition.utils';

describe('aws partition utils', () => {
  it('uses GovCloud defaults for the aws-us-gov partition', () => {
    expect(getAwsDefaultRegion('aws')).toBe('us-east-1');
    expect(getAwsDefaultRegion('aws-us-gov')).toBe('us-gov-west-1');
    expect(getAwsPartitionForRegion('us-east-1')).toBe('aws');
    expect(getAwsPartitionForRegion('us-gov-east-1')).toBe('aws-us-gov');
  });

  it('parses commercial and GovCloud role ARNs', () => {
    expect(
      parseAwsRoleArn('arn:aws:iam::123456789012:role/OpenComp-Auditor'),
    ).toEqual({
      partition: 'aws',
      accountId: '123456789012',
      roleName: 'OpenComp-Auditor',
    });
    expect(
      parseAwsRoleArn('arn:aws-us-gov:iam::123456789012:role/OpenComp-Auditor'),
    ).toEqual({
      partition: 'aws-us-gov',
      accountId: '123456789012',
      roleName: 'OpenComp-Auditor',
    });
  });

  it('trims whitespace before parsing role ARNs', () => {
    // Pasted ARNs often carry a trailing space — parsing must behave the
    // same as validation (which trims) so a validated ARN never fails later.
    expect(
      parseAwsRoleArn('  arn:aws:iam::123456789012:role/OpenComp-Auditor  '),
    ).toEqual({
      partition: 'aws',
      accountId: '123456789012',
      roleName: 'OpenComp-Auditor',
    });
    expect(parseAwsRoleArn('not-an-arn')).toBeNull();
    expect(parseAwsRoleArn('')).toBeNull();
  });

  it('accepts whitespace-padded ARNs at the validation layer', () => {
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: '  arn:aws:iam::123456789012:role/OpenComp-Auditor  ',
        regions: ['us-east-1'],
        remediationRoleArn:
          '  arn:aws:iam::123456789012:role/OpenComp-Remediator  ',
      }),
    ).toEqual([]);
  });

  it('accepts a GovCloud remediation role in the GovCloud partition', () => {
    expect(
      validateAwsPartitionConfig({
        partition: 'aws-us-gov',
        roleArn: 'arn:aws-us-gov:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-gov-west-1'],
        remediationRoleArn:
          'arn:aws-us-gov:iam::123456789012:role/OpenComp-Remediator-Storage-us-gov-west-1',
      }),
    ).toEqual([]);
  });

  it('rejects mismatched role ARN and region partitions', () => {
    expect(
      validateAwsPartitionConfig({
        partition: 'aws-us-gov',
        roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-gov-west-1', 'us-east-1'],
      }),
    ).toEqual([
      'IAM Role ARN partition (aws) must match selected AWS environment (aws-us-gov).',
      'Selected regions do not match aws-us-gov: us-east-1.',
    ]);
  });

  it('accepts the legacy remediator and per-class/region role names', () => {
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-east-1'],
        remediationRoleArn:
          'arn:aws:iam::123456789012:role/OpenComp-Remediator',
      }),
    ).toEqual([]);

    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-east-1'],
        remediationRoleArn:
          'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
      }),
    ).toEqual([]);

    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-east-1'],
        remediationRoleArn:
          'arn:aws:iam::123456789012:role/team/OpenComp-Remediator-Storage-us-east-1',
      }),
    ).toEqual([]);
  });

  it('rejects remediation role confusion: auditor reuse, cross-account, wrong name', () => {
    const base = {
      partition: 'aws' as const,
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      regions: ['us-east-1'],
    };

    // Reusing the auditor role for remediation is never allowed (fails
    // both the distinctness and the name check).
    expect(
      validateAwsPartitionConfig({
        ...base,
        remediationRoleArn: base.roleArn,
      }),
    ).toEqual([
      expect.stringContaining('must differ from the auditor Role ARN'),
      expect.stringContaining('must reference OpenComp-Remediator'),
    ]);

    // Cross-account remediation ARN is a paste mistake, not a feature.
    expect(
      validateAwsPartitionConfig({
        ...base,
        remediationRoleArn:
          'arn:aws:iam::999999999999:role/OpenComp-Remediator',
      }),
    ).toEqual([expect.stringContaining('must match the auditor')]);

    // Non-remediator roles (admin, service, lookalike names) are rejected.
    // (Auditor-role reuse is covered above — it fails on two checks.)
    for (const roleName of ['Admin', 'MyServiceRole', 'OpenComp-RemediatorX']) {
      expect(
        validateAwsPartitionConfig({
          ...base,
          remediationRoleArn: `arn:aws:iam::123456789012:role/${roleName}`,
        }),
      ).toEqual([
        expect.stringContaining('must reference OpenComp-Remediator'),
      ]);
    }
  });

  it('rejects a remediation role without an auditor role to compare against', () => {
    // Without an auditor ARN the same-account check cannot run — fail
    // closed instead of validating with fewer checks.
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: undefined,
        regions: ['us-east-1'],
        remediationRoleArn:
          'arn:aws:iam::123456789012:role/OpenComp-Remediator',
      }),
    ).toEqual([expect.stringContaining('Auditor Role ARN is required')]);

    // A garbage auditor ARN is no better: the format error fires and the
    // remediation checks still refuse to run unanchored.
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: 'not-an-arn',
        regions: ['us-east-1'],
        remediationRoleArn:
          'arn:aws:iam::123456789012:role/OpenComp-Remediator',
      }),
    ).toEqual([
      expect.stringContaining('Invalid IAM Role ARN format'),
      expect.stringContaining('Auditor Role ARN is required'),
    ]);
  });

  it('validates remediation role names', () => {
    expect(isValidRemediationRoleName('OpenComp-Remediator')).toBe(true);
    expect(
      isValidRemediationRoleName('OpenComp-Remediator-Storage-us-east-1'),
    ).toBe(true);
    // IAM paths are ignored — the allowlist applies to the bare role name.
    expect(isValidRemediationRoleName('team/OpenComp-Remediator')).toBe(true);
    expect(
      isValidRemediationRoleName('team/OpenComp-Remediator-Storage-us-east-1'),
    ).toBe(true);
    expect(isValidRemediationRoleName('OpenComp-Auditor')).toBe(false);
    expect(isValidRemediationRoleName('team/Admin')).toBe(false);
    expect(isValidRemediationRoleName('Admin')).toBe(false);
  });

  it('gates the write path on remediation role ARN + External ID', () => {
    const arn = 'arn:aws:iam::123456789012:role/OpenComp-Remediator';
    expect(
      hasRemediationRole({ remediationRoleArn: arn, externalId: 'ext-1' }),
    ).toBe(true);
    // Either value missing or blank closes the gate — the auditor
    // credentials must never substitute for writes.
    expect(hasRemediationRole({})).toBe(false);
    expect(hasRemediationRole({ remediationRoleArn: arn })).toBe(false);
    expect(hasRemediationRole({ externalId: 'ext-1' })).toBe(false);
    expect(
      hasRemediationRole({ remediationRoleArn: '   ', externalId: 'ext-1' }),
    ).toBe(false);
    expect(
      hasRemediationRole({ remediationRoleArn: arn, externalId: '   ' }),
    ).toBe(false);
    expect(
      hasRemediationRole({ remediationRoleArn: 42, externalId: 'ext-1' }),
    ).toBe(false);
  });

  it('accepts commercial and GovCloud configurations independently', () => {
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-east-1', 'us-west-2'],
      }),
    ).toEqual([]);

    expect(
      validateAwsPartitionConfig({
        partition: 'aws-us-gov',
        roleArn: 'arn:aws-us-gov:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-gov-west-1', 'us-gov-east-1'],
      }),
    ).toEqual([]);
  });

  it('uses explicit GovCloud base credentials when configured', () => {
    process.env.SECURITY_HUB_GOVCLOUD_ACCESS_KEY_ID = 'AKIAGOV';
    process.env.SECURITY_HUB_GOVCLOUD_SECRET_ACCESS_KEY = 'secret';
    process.env.SECURITY_HUB_GOVCLOUD_SESSION_TOKEN = 'placeholder';

    expect(getAwsBaseCredentials('aws-us-gov')).toEqual({
      accessKeyId: 'AKIAGOV',
      secretAccessKey: 'secret',
    });
    expect(getAwsBaseCredentials('aws')).toBeUndefined();

    delete process.env.SECURITY_HUB_GOVCLOUD_ACCESS_KEY_ID;
    delete process.env.SECURITY_HUB_GOVCLOUD_SECRET_ACCESS_KEY;
    delete process.env.SECURITY_HUB_GOVCLOUD_SESSION_TOKEN;
  });
});
