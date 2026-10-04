import { describe, expect, it } from 'vitest';
import {
  buildRemediationPolicyDocument,
  escapeDoubleQuotedShell,
  findingToAssetClass,
  FIX_FORWARD_ALLOWLIST,
  getRemediationRolesParseError,
  isRemediationRoleKey,
  NEVER_ALLOW_REMEDIATION_ACTIONS,
  parseRemediationRolesMap,
  REMEDIATION_ASSET_CLASSES,
  remediationRoleKey,
  remediationRoleName,
  SECURITY_GLOBAL_PINNED_REGION,
  serializeRemediationRolesMap,
} from '../remediation-roles';

describe('findingToAssetClass', () => {
  it('maps known resource types to their class', () => {
    expect(findingToAssetClass('aws-s3-bucket')).toBe('Storage');
    expect(findingToAssetClass('aws-security-group')).toBe('Compute');
    expect(findingToAssetClass('aws-rds-instance')).toBe('Data');
    expect(findingToAssetClass('aws-rds-cluster')).toBe('Data');
    expect(findingToAssetClass('aws-rds')).toBe('Data');
    expect(findingToAssetClass('aws-kms-key')).toBe('Security-Global');
    expect(findingToAssetClass('aws-cloudtrail')).toBe('Security-Global');
    expect(findingToAssetClass('aws-account')).toBe('Security-Global');
    expect(findingToAssetClass('aws-environment-separation')).toBe('Security-Global');
  });

  it('maps the legacy PascalCase adapter taxonomy too', () => {
    expect(findingToAssetClass('AwsS3Bucket')).toBe('Storage');
    expect(findingToAssetClass('S3Bucket')).toBe('Storage');
    expect(findingToAssetClass('AwsDynamoDbTable')).toBe('Storage');
    expect(findingToAssetClass('AwsEc2SecurityGroup')).toBe('Compute');
    expect(findingToAssetClass('AwsLambdaFunction')).toBe('Compute');
    expect(findingToAssetClass('AwsElbLoadBalancer')).toBe('Network');
    expect(findingToAssetClass('AwsSnsTopic')).toBe('Data');
    expect(findingToAssetClass('AwsRdsDbInstance')).toBe('Data');
    expect(findingToAssetClass('AwsIamUser')).toBe('Security-Global');
    expect(findingToAssetClass('AwsKmsKey')).toBe('Security-Global');
  });

  it('fails closed to Security-Global for unknown or non-string types', () => {
    expect(findingToAssetClass('aws-totally-new-service')).toBe('Security-Global');
    expect(findingToAssetClass('')).toBe('Security-Global');
    expect(findingToAssetClass(undefined)).toBe('Security-Global');
    expect(findingToAssetClass(null)).toBe('Security-Global');
    expect(findingToAssetClass(42)).toBe('Security-Global');
  });

  it('fails closed on Object.prototype members instead of misrouting', () => {
    expect(findingToAssetClass('toString')).toBe('Security-Global');
    expect(findingToAssetClass('constructor')).toBe('Security-Global');
    expect(findingToAssetClass('__proto__')).toBe('Security-Global');
    expect(findingToAssetClass('hasOwnProperty')).toBe('Security-Global');
  });
});

describe('remediationRoleName', () => {
  it('builds per-pair names and pins the global role', () => {
    expect(remediationRoleName({ assetClass: 'Storage', region: 'us-east-1' })).toBe(
      'OpenComp-Remediator-Storage-us-east-1',
    );
    expect(remediationRoleName({ assetClass: 'Data', region: 'eu-central-1' })).toBe(
      'OpenComp-Remediator-Data-eu-central-1',
    );
    expect(remediationRoleName({ assetClass: 'Security-Global', region: 'eu-west-1' })).toBe(
      'OpenComp-Remediator-Security-Global',
    );
  });

  it('rejects blank regions instead of minting a malformed name', () => {
    expect(() => remediationRoleName({ assetClass: 'Storage', region: '  ' })).toThrow();
  });

  it('rejects shell-unsafe regions instead of minting a poisoned name', () => {
    expect(() =>
      remediationRoleName({ assetClass: 'Storage', region: 'us-east-1"; evil #' }),
    ).toThrow();
    expect(() => remediationRoleName({ assetClass: 'Storage', region: 'us-east-$(1)' })).toThrow();
    expect(() => remediationRoleName({ assetClass: 'Storage', region: 'US-EAST-1' })).toThrow();
  });
});

describe('remediationRoleKey', () => {
  it('builds Class:region keys and pins the global key', () => {
    expect(remediationRoleKey({ assetClass: 'Network', region: 'us-west-2' })).toBe(
      'Network:us-west-2',
    );
    expect(remediationRoleKey({ assetClass: 'Security-Global', region: 'eu-west-1' })).toBe(
      `Security-Global:${SECURITY_GLOBAL_PINNED_REGION}`,
    );
  });
});

describe('isRemediationRoleKey', () => {
  it('accepts well-formed keys', () => {
    expect(isRemediationRoleKey('Storage:us-east-1')).toBe(true);
    expect(isRemediationRoleKey(`Security-Global:${SECURITY_GLOBAL_PINNED_REGION}`)).toBe(true);
  });

  it('rejects unknown classes, blank regions, and unpinned global keys', () => {
    expect(isRemediationRoleKey('Bogus:us-east-1')).toBe(false);
    expect(isRemediationRoleKey('Storage:')).toBe(false);
    expect(isRemediationRoleKey('Storage')).toBe(false);
    expect(isRemediationRoleKey('Security-Global:eu-west-1')).toBe(false);
    expect(isRemediationRoleKey('')).toBe(false);
  });

  it('rejects shell-unsafe regions in keys', () => {
    expect(isRemediationRoleKey('Storage:us-east-1"; evil #')).toBe(false);
    expect(isRemediationRoleKey('Storage:us-east-$(1)')).toBe(false);
  });
});

describe('parseRemediationRolesMap', () => {
  it('parses a JSON string map and trims entries', () => {
    expect(
      parseRemediationRolesMap(
        '{"Storage:us-east-1":"  arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1  "}',
      ),
    ).toEqual({
      'Storage:us-east-1': 'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
    });
  });

  it('fails closed to {} on garbage input', () => {
    expect(parseRemediationRolesMap('')).toEqual({});
    expect(parseRemediationRolesMap('not-json')).toEqual({});
    expect(parseRemediationRolesMap('[]')).toEqual({});
    expect(parseRemediationRolesMap(null)).toEqual({});
    expect(parseRemediationRolesMap(undefined)).toEqual({});
    expect(parseRemediationRolesMap(42)).toEqual({});
  });

  it('drops non-string and blank values', () => {
    expect(parseRemediationRolesMap({ 'Storage:us-east-1': '  ', 'Data:eu-west-1': 42 })).toEqual(
      {},
    );
  });

  it('round-trips through serialize', () => {
    const map = { 'Storage:us-east-1': 'arn:aws:iam::1:role/A' };
    expect(parseRemediationRolesMap(serializeRemediationRolesMap(map))).toEqual(map);
  });
});

describe('getRemediationRolesParseError', () => {
  it('accepts absent, blank, and well-formed object input', () => {
    expect(getRemediationRolesParseError(undefined)).toBeNull();
    expect(getRemediationRolesParseError(null)).toBeNull();
    expect(getRemediationRolesParseError('')).toBeNull();
    expect(getRemediationRolesParseError('   ')).toBeNull();
    expect(
      getRemediationRolesParseError('{"Storage:us-east-1":"arn:aws:iam::1:role/A"}'),
    ).toBeNull();
    expect(getRemediationRolesParseError({ 'Storage:us-east-1': 'arn' })).toBeNull();
  });

  it('rejects unparseable text, arrays, and primitives', () => {
    expect(getRemediationRolesParseError('not-json')).not.toBeNull();
    expect(getRemediationRolesParseError('[1,2]')).not.toBeNull();
    expect(getRemediationRolesParseError('"just-a-string"')).not.toBeNull();
    expect(getRemediationRolesParseError('123')).not.toBeNull();
    expect(getRemediationRolesParseError(42)).not.toBeNull();
  });

  it('rejects blank keys the read-path parser would silently drop', () => {
    // parseRemediationRolesMap trims keys and skips blanks, yielding `{}` —
    // validation must surface the garbage instead of passing zero entries.
    expect(getRemediationRolesParseError('{"": "arn:aws:iam::1:role/A"}')).not.toBeNull();
    expect(getRemediationRolesParseError('{"   ": "arn:aws:iam::1:role/A"}')).not.toBeNull();
    expect(getRemediationRolesParseError({ '': 'arn:aws:iam::1:role/A' })).not.toBeNull();
  });

  it('rejects keys that collide after trimming', () => {
    // Last-write-wins in the parser would drop one ARN without validating
    // it — both entries must be visible to trust validation.
    const colliding =
      '{"Storage:us-east-1": "arn:aws:iam::1:role/A", " Storage:us-east-1 ": "arn:aws:iam::1:role/B"}';
    expect(getRemediationRolesParseError(colliding)).toContain('duplicate key');
  });

  it('rejects non-string and blank ARN values per entry', () => {
    expect(getRemediationRolesParseError('{"Storage:us-east-1": "  "}')).toContain(
      'must be a non-empty role ARN string',
    );
    expect(getRemediationRolesParseError({ 'Storage:us-east-1': 42 })).toContain(
      'must be a non-empty role ARN string',
    );
  });
});

describe('escapeDoubleQuotedShell', () => {
  it('escapes quotes, dollar, backticks, and backslashes', () => {
    expect(escapeDoubleQuotedShell('org_abc123')).toBe('org_abc123');
    expect(escapeDoubleQuotedShell('a"b$c`d\\e')).toBe('a\\"b\\$c\\`d\\\\e');
  });

  it('strips carriage returns and newlines (line-continuation injection)', () => {
    // A backslash-newline inside double quotes is a line continuation, not
    // an escape — newlines must be removed so a value cannot inject a new
    // shell line into the generated setup script.
    expect(escapeDoubleQuotedShell('org_1\nINJECTED=true')).toBe('org_1INJECTED=true');
    expect(escapeDoubleQuotedShell('a\rb\nc')).toBe('abc');
  });
});

describe('FIX_FORWARD_ALLOWLIST', () => {
  it('covers every asset class', () => {
    for (const assetClass of REMEDIATION_ASSET_CLASSES) {
      expect(FIX_FORWARD_ALLOWLIST[assetClass].length).toBeGreaterThan(0);
    }
  });

  it('grants no privilege-escalation, destructive, or exfiltration actions', () => {
    const banned = [
      'iam:CreateRole',
      'iam:PutRolePolicy',
      'iam:PassRole',
      's3:PutBucketPolicy',
      's3:CreateBucket',
      'sns:Subscribe',
      'events:PutPermission',
      'shield:CreateSubscription',
      'backup:DeleteBackupPlan',
      'wafv2:UpdateWebACL',
      'cognito-idp:UpdateUserPool',
      'guardduty:UpdateDetector',
    ];
    const granted = new Set(Object.values(FIX_FORWARD_ALLOWLIST).flat());
    for (const action of banned) {
      expect(granted.has(action)).toBe(false);
    }
    // No Delete/Disable/Stop verbs anywhere in the allowlist.
    for (const action of granted) {
      expect(action).not.toMatch(/:(Delete|Disable|Stop)/);
    }
  });
});

describe('NEVER_ALLOW_REMEDIATION_ACTIONS', () => {
  it('names the Phase-0 kill-switch, escalation, and exfil actions', () => {
    for (const action of [
      'iam:PassRole',
      'iam:Put*',
      'iam:Create*',
      's3:PutBucketPolicy',
      'guardduty:Update*',
      'shield:CreateSubscription',
    ]) {
      expect(NEVER_ALLOW_REMEDIATION_ACTIONS).toContain(action);
    }
  });

  it('denies IAM writes without denying the allowlisted IAM reads', () => {
    // Explicit Deny wins over Allow in IAM — a blanket `iam:*` Deny would
    // nullify the four reads the fix-forward allowlist grants.
    const deny = NEVER_ALLOW_REMEDIATION_ACTIONS as readonly string[];
    expect(deny).not.toContain('iam:*');
    for (const read of [
      'iam:GetAccountPasswordPolicy',
      'iam:ListRolePolicies',
      'iam:GetRolePolicy',
      'iam:GetRole',
    ]) {
      expect(FIX_FORWARD_ALLOWLIST['Security-Global']).toContain(read);
      expect(deny).not.toContain(read);
    }
  });
});

describe('buildRemediationPolicyDocument', () => {
  it('emits the 3-statement shape with a region gate for regional roles', () => {
    const doc = buildRemediationPolicyDocument({ assetClass: 'Storage', region: 'us-east-1' });
    expect(doc.Version).toBe('2012-10-17');
    expect(doc.Statement.map((s) => s.Sid)).toEqual([
      'FixForwardOnly',
      'DenyOutsideRegion',
      'NeverDestructive',
    ]);
    const allow = doc.Statement[0] as { Condition: unknown };
    expect(allow.Condition).toEqual({ StringEquals: { 'aws:RequestedRegion': ['us-east-1'] } });
    // IfExists: keyless calls (S3, global APIs) must not match the deny —
    // plain StringNotEquals is true when the key is absent.
    const deny = doc.Statement[1] as { Condition: unknown };
    expect(deny.Condition).toEqual({
      StringNotEqualsIfExists: { 'aws:RequestedRegion': ['us-east-1'] },
    });
  });

  it('omits the region gate for Security-Global (assumed in us-east-1 with approval)', () => {
    const doc = buildRemediationPolicyDocument({
      assetClass: 'Security-Global',
      region: 'us-east-1',
    });
    expect(doc.Statement.map((s) => s.Sid)).toEqual(['FixForwardOnly', 'NeverDestructive']);
  });
});
