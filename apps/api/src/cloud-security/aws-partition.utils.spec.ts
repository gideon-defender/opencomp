import {
  getAwsBaseCredentials,
  getAwsDefaultRegion,
  getAwsPartitionForRegion,
  hasRemediationRole,
  isValidRemediationRoleName,
  parseAwsRoleArn,
  remediationRoleNameFromArn,
  resolveRemediationRoleArn,
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

  it('rejects shell metacharacters in the role token', () => {
    // A validated ARN is interpolated into generated grant scripts inside
    // double quotes — `"`, `$`, backticks, and `;` must never parse.
    for (const roleName of [
      'OpenComp-Remediator-Storage-us-east-1"; evil #',
      'OpenComp-Remediator-$(whoami)',
      'OpenComp-Remediator-`id`',
      "OpenComp-Remediator-'; evil",
      'OpenComp-Remediator-$HOME',
    ]) {
      expect(
        parseAwsRoleArn(`arn:aws:iam::123456789012:role/${roleName}`),
      ).toBeNull();
    }
    // IAM paths and the documented charset still parse.
    expect(
      parseAwsRoleArn(
        'arn:aws:iam::123456789012:role/team/OpenComp-Remediator',
      ),
    ).not.toBeNull();
  });

  it('accepts whitespace-padded ARNs at the validation layer', () => {
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: '  arn:aws:iam::123456789012:role/OpenComp-Auditor  ',
        regions: ['us-east-1'],
        remediationRoles: JSON.stringify({
          'Storage:us-east-1':
            '  arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1  ',
        }),
      }),
    ).toEqual([]);
  });

  it('accepts a GovCloud pair role in the GovCloud partition', () => {
    expect(
      validateAwsPartitionConfig({
        partition: 'aws-us-gov',
        roleArn: 'arn:aws-us-gov:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-gov-west-1'],
        remediationRoles: JSON.stringify({
          'Storage:us-gov-west-1':
            'arn:aws-us-gov:iam::123456789012:role/OpenComp-Remediator-Storage-us-gov-west-1',
        }),
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

  it('accepts per-class/region pair roles and binds entries to their pair', () => {
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-east-1'],
        remediationRoles: JSON.stringify({
          'Storage:us-east-1':
            'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
        }),
      }),
    ).toEqual([]);

    // IAM paths address a different role object than the bare name, so a
    // pathed ARN must fail closed instead of validating clean.
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
        regions: ['us-east-1'],
        remediationRoles: JSON.stringify({
          'Storage:us-east-1':
            'arn:aws:iam::123456789012:role/team/OpenComp-Remediator-Storage-us-east-1',
        }),
      }),
    ).toEqual([
      expect.stringContaining(
        'must reference the "OpenComp-Remediator-Storage-us-east-1" role',
      ),
    ]);
  });

  it('rejects remediation role confusion: auditor reuse, cross-account, wrong name', () => {
    const base = {
      partition: 'aws' as const,
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      regions: ['us-east-1'],
    };
    const entryFor = (arn: string) =>
      JSON.stringify({ 'Storage:us-east-1': arn });

    // Reusing the auditor role for remediation is never allowed (fails
    // the distinctness, the name, and the binding checks).
    expect(
      validateAwsPartitionConfig({
        ...base,
        remediationRoles: entryFor(base.roleArn),
      }),
    ).toEqual([
      expect.stringContaining('must differ from the auditor Role ARN'),
      expect.stringContaining('must reference OpenComp-Remediator'),
      expect.stringContaining(
        'must reference the "OpenComp-Remediator-Storage-us-east-1" role',
      ),
    ]);

    // Cross-account remediation ARN is a paste mistake, not a feature.
    expect(
      validateAwsPartitionConfig({
        ...base,
        remediationRoles: entryFor(
          'arn:aws:iam::999999999999:role/OpenComp-Remediator-Storage-us-east-1',
        ),
      }),
    ).toEqual([expect.stringContaining('must match the auditor')]);

    // Non-remediator roles (admin, service, lookalike names) fail the name
    // check and the exact-pair binding.
    for (const roleName of ['Admin', 'MyServiceRole', 'OpenComp-RemediatorX']) {
      expect(
        validateAwsPartitionConfig({
          ...base,
          remediationRoles: entryFor(
            `arn:aws:iam::123456789012:role/${roleName}`,
          ),
        }),
      ).toEqual([
        expect.stringContaining('must reference OpenComp-Remediator'),
        expect.stringContaining(
          'must reference the "OpenComp-Remediator-Storage-us-east-1" role',
        ),
      ]);
    }
  });

  it('rejects a pair entry without an auditor role to compare against', () => {
    // Without an auditor ARN the same-account check cannot run — fail
    // closed instead of validating with fewer checks.
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: undefined,
        regions: ['us-east-1'],
        remediationRoles: JSON.stringify({
          'Storage:us-east-1':
            'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
        }),
      }),
    ).toEqual([expect.stringContaining('Auditor Role ARN is required')]);

    // A garbage auditor ARN is no better: the format error fires and the
    // remediation checks still refuse to run unanchored.
    expect(
      validateAwsPartitionConfig({
        partition: 'aws',
        roleArn: 'not-an-arn',
        regions: ['us-east-1'],
        remediationRoles: JSON.stringify({
          'Storage:us-east-1':
            'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
        }),
      }),
    ).toEqual([
      expect.stringContaining('Invalid IAM Role ARN format'),
      expect.stringContaining('Auditor Role ARN is required'),
    ]);
  });

  it('validates remediation role names', () => {
    expect(
      isValidRemediationRoleName('OpenComp-Remediator-Storage-us-east-1'),
    ).toBe(true);
    // The removed monolith name no longer validates — only pair names do.
    expect(isValidRemediationRoleName('OpenComp-Remediator')).toBe(false);
    // IAM paths are ignored — the allowlist applies to the bare role name.
    expect(
      isValidRemediationRoleName('team/OpenComp-Remediator-Storage-us-east-1'),
    ).toBe(true);
    expect(isValidRemediationRoleName('team/OpenComp-Remediator')).toBe(false);
    expect(isValidRemediationRoleName('OpenComp-Auditor')).toBe(false);
    expect(isValidRemediationRoleName('team/Admin')).toBe(false);
    expect(isValidRemediationRoleName('Admin')).toBe(false);
  });

  it('gates the write path on a pair entry + External ID', () => {
    const map = JSON.stringify({
      'Storage:us-east-1':
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
    });
    expect(
      hasRemediationRole({ remediationRoles: map, externalId: 'ext-1' }),
    ).toBe(true);
    // Either value missing or blank closes the gate — the auditor
    // credentials must never substitute for writes.
    expect(hasRemediationRole({})).toBe(false);
    expect(hasRemediationRole({ remediationRoles: map })).toBe(false);
    expect(hasRemediationRole({ externalId: 'ext-1' })).toBe(false);
    expect(
      hasRemediationRole({ remediationRoles: '   ', externalId: 'ext-1' }),
    ).toBe(false);
    expect(
      hasRemediationRole({ remediationRoles: map, externalId: '   ' }),
    ).toBe(false);
    expect(
      hasRemediationRole({ remediationRoles: 42, externalId: 'ext-1' }),
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

  describe('remediationRoles pair map', () => {
    const AUDITOR = 'arn:aws:iam::123456789012:role/OpenComp-Auditor';
    const PAIR_ARN =
      'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1';

    it('accepts a valid pair map', () => {
      expect(
        validateAwsPartitionConfig({
          partition: 'aws',
          roleArn: AUDITOR,
          regions: ['us-east-1'],
          remediationRoles: { 'Storage:us-east-1': PAIR_ARN },
        }),
      ).toEqual([]);
    });

    it('rejects malformed map keys fail-closed', () => {
      expect(
        validateAwsPartitionConfig({
          partition: 'aws',
          roleArn: AUDITOR,
          regions: ['us-east-1'],
          remediationRoles: { 'Bogus:us-east-1': PAIR_ARN },
        }),
      ).toEqual([expect.stringContaining('invalid key')]);
      expect(
        validateAwsPartitionConfig({
          partition: 'aws',
          roleArn: AUDITOR,
          regions: ['us-east-1'],
          remediationRoles: { 'Security-Global:eu-west-1': PAIR_ARN },
        }),
      ).toEqual([expect.stringContaining('invalid key')]);
    });

    it('applies the same fail-closed ARN rules to every entry', () => {
      const base = {
        partition: 'aws' as const,
        roleArn: AUDITOR,
        regions: ['us-east-1'],
      };
      // Cross-account entry.
      expect(
        validateAwsPartitionConfig({
          ...base,
          remediationRoles: {
            'Storage:us-east-1':
              'arn:aws:iam::999999999999:role/OpenComp-Remediator-Storage-us-east-1',
          },
        }),
      ).toEqual([
        expect.stringContaining('must match the auditor Role ARN account'),
      ]);
      // Auditor-reuse entry.
      expect(
        validateAwsPartitionConfig({
          ...base,
          remediationRoles: { 'Storage:us-east-1': AUDITOR },
        }),
      ).toEqual([
        expect.stringContaining('must differ from the auditor Role ARN'),
        expect.stringContaining('must reference OpenComp-Remediator'),
        // Binding fires too: the auditor ARN names no pair role.
        expect.stringContaining(
          'must reference the "OpenComp-Remediator-Storage-us-east-1" role',
        ),
      ]);
      // Non-remediator name entry.
      expect(
        validateAwsPartitionConfig({
          ...base,
          remediationRoles: {
            'Storage:us-east-1': 'arn:aws:iam::123456789012:role/Admin',
          },
        }),
      ).toEqual([
        expect.stringContaining('must reference OpenComp-Remediator'),
        expect.stringContaining(
          'must reference the "OpenComp-Remediator-Storage-us-east-1" role',
        ),
      ]);
    });

    it('treats the map as a JSON credential string too', () => {
      expect(
        validateAwsPartitionConfig({
          partition: 'aws',
          roleArn: AUDITOR,
          regions: ['us-east-1'],
          remediationRoles: JSON.stringify({ 'Storage:us-east-1': PAIR_ARN }),
        }),
      ).toEqual([]);
    });

    it('rejects malformed raw map input instead of passing with zero entries', () => {
      for (const remediationRoles of ['not-json', '[1,2]', '123', '"str"']) {
        expect(
          validateAwsPartitionConfig({
            partition: 'aws',
            roleArn: AUDITOR,
            regions: ['us-east-1'],
            remediationRoles,
          }),
        ).toEqual([expect.stringContaining('must be a JSON object')]);
      }
    });

    it('binds each entry to its pair role instead of any remediator name', () => {
      const base = {
        partition: 'aws' as const,
        roleArn: AUDITOR,
        regions: ['us-east-1'],
      };
      // Storage key pointing at the global role: valid name, wrong pair.
      expect(
        validateAwsPartitionConfig({
          ...base,
          remediationRoles: {
            'Storage:us-east-1':
              'arn:aws:iam::123456789012:role/OpenComp-Remediator-Security-Global',
          },
        }),
      ).toEqual([
        expect.stringContaining(
          'must reference the "OpenComp-Remediator-Storage-us-east-1" role',
        ),
      ]);
      // Suffix-sharing IAM path is a different role object, not an identity.
      expect(
        validateAwsPartitionConfig({
          ...base,
          remediationRoles: {
            'Storage:us-east-1':
              'arn:aws:iam::123456789012:role/extra-path/OpenComp-Remediator-Storage-us-east-1',
          },
        }),
      ).toEqual([
        expect.stringContaining('must reference the "OpenComp-Remediator'),
      ]);
    });

    it('rejects shell-unsafe and malformed region names', () => {
      expect(
        validateAwsPartitionConfig({
          partition: 'aws',
          roleArn: AUDITOR,
          regions: ['us-east-1"; evil #'],
          remediationRoles: { 'Storage:us-east-1': PAIR_ARN },
        }),
      ).toEqual([expect.stringContaining('Invalid AWS region names')]);
    });
  });

  describe('hasRemediationRole with pair map', () => {
    const PAIR_ARN =
      'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1';

    it('is true with a non-empty map plus External ID', () => {
      expect(
        hasRemediationRole({
          externalId: 'ext-1',
          remediationRoles: JSON.stringify({
            'Storage:us-east-1':
              'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
          }),
        }),
      ).toBe(true);
    });

    it('is false with an empty or garbage map and no legacy ARN', () => {
      expect(
        hasRemediationRole({ externalId: 'ext-1', remediationRoles: '{}' }),
      ).toBe(false);
      expect(
        hasRemediationRole({ externalId: 'ext-1', remediationRoles: 'nope' }),
      ).toBe(false);
      expect(hasRemediationRole({ externalId: 'ext-1' })).toBe(false);
    });

    it('ignores entries that can never satisfy resolution', () => {
      // Invalid keys and malformed ARNs match no finding — the gate must
      // stay closed so setup fails visibly instead of at assume time.
      expect(
        hasRemediationRole({
          externalId: 'ext-1',
          remediationRoles: JSON.stringify({
            'Bogus:us-east-1': 'arn:aws:iam::1:role/A',
          }),
        }),
      ).toBe(false);
      expect(
        hasRemediationRole({
          externalId: 'ext-1',
          remediationRoles: JSON.stringify({
            'Storage:us-east-1': 'not-an-arn',
          }),
        }),
      ).toBe(false);
    });

    it('still requires the External ID with a map present', () => {
      const map = JSON.stringify({ 'Storage:us-east-1': PAIR_ARN });
      // A valid pair entry alone must not flip the gate — the External ID
      // check must hold independently of the map.
      expect(hasRemediationRole({ remediationRoles: map })).toBe(false);
      expect(
        hasRemediationRole({ externalId: '   ', remediationRoles: map }),
      ).toBe(false);
      expect(
        hasRemediationRole({ externalId: 'ext-1', remediationRoles: map }),
      ).toBe(true);
    });

    it('ignores a stored legacy ARN (removed credential)', () => {
      // The monolith credential no longer exists: a stored legacy value
      // alone must not open the gate, and it must not break a valid map.
      expect(
        hasRemediationRole({
          externalId: 'ext-1',
          remediationRoleArn:
            'arn:aws:iam::123456789012:role/OpenComp-Remediator',
        }),
      ).toBe(false);
      expect(
        hasRemediationRole({
          externalId: 'ext-1',
          remediationRoleArn: 'not-an-arn',
          remediationRoles: JSON.stringify({ 'Storage:us-east-1': PAIR_ARN }),
        }),
      ).toBe(true);
    });
  });

  describe('resolveRemediationRoleArn', () => {
    const MAP = JSON.stringify({
      'Storage:us-east-1':
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
      'Security-Global:us-east-1':
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Security-Global',
    });
    const LEGACY = 'arn:aws:iam::123456789012:role/OpenComp-Remediator';

    it('resolves the pair entry for the finding', () => {
      expect(
        resolveRemediationRoleArn({
          credentials: { remediationRoles: MAP },
          resourceType: 'aws-s3-bucket',
          region: 'us-east-1',
        }),
      ).toBe(
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
      );
    });

    it('pins Security-Global findings to the global role regardless of region', () => {
      expect(
        resolveRemediationRoleArn({
          credentials: { remediationRoles: MAP },
          resourceType: 'aws-cloudtrail',
          region: 'eu-west-1',
        }),
      ).toBe(
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Security-Global',
      );
    });

    it('returns undefined when the pair key is absent, even with a stored legacy value', () => {
      expect(
        resolveRemediationRoleArn({
          credentials: { remediationRoles: MAP, remediationRoleArn: LEGACY },
          resourceType: 'aws-rds-instance',
          region: 'us-east-1',
        }),
      ).toBeUndefined();
    });

    it('returns undefined when the map does not cover the pair', () => {
      expect(
        resolveRemediationRoleArn({
          credentials: { remediationRoles: MAP },
          resourceType: 'aws-rds-instance',
          region: 'us-east-1',
        }),
      ).toBeUndefined();
    });

    it('refuses to route a key to another pair\u2019s role (exact-pair binding)', () => {
      // Storage key pointing at the Security-Global role must not resolve —
      // assuming it would promote the finding to the widest-blast-radius role.
      expect(
        resolveRemediationRoleArn({
          credentials: {
            remediationRoles: JSON.stringify({
              'Storage:us-east-1':
                'arn:aws:iam::123456789012:role/OpenComp-Remediator-Security-Global',
            }),
          },
          resourceType: 'aws-s3-bucket',
          region: 'us-east-1',
        }),
      ).toBeUndefined();
    });

    it('refuses to route a suffix-sharing IAM path (different role object)', () => {
      expect(
        resolveRemediationRoleArn({
          credentials: {
            remediationRoles: JSON.stringify({
              'Storage:us-east-1':
                'arn:aws:iam::123456789012:role/team/OpenComp-Remediator-Storage-us-east-1',
            }),
          },
          resourceType: 'aws-s3-bucket',
          region: 'us-east-1',
        }),
      ).toBeUndefined();
    });
  });

  describe('remediationRoleNameFromArn', () => {
    it('returns the bare role name without the IAM path', () => {
      expect(
        remediationRoleNameFromArn(
          'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
        ),
      ).toBe('OpenComp-Remediator-Storage-us-east-1');
      expect(
        remediationRoleNameFromArn(
          'arn:aws:iam::123456789012:role/team/OpenComp-Remediator',
        ),
      ).toBe('OpenComp-Remediator');
    });

    it('returns undefined for unparseable ARNs', () => {
      expect(remediationRoleNameFromArn('not-an-arn')).toBeUndefined();
    });
  });
});
