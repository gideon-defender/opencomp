import {
  parseAwsPermissionError,
  parseAzurePermissionError,
  parseGcpPermissionError,
} from './remediation-error.utils';

describe('parseAwsPermissionError', () => {
  it('detects "required X permission" pattern', () => {
    const msg =
      'The request was rejected because you do not have the required iam:CreateServiceLinkedRole permission.';
    const result = parseAwsPermissionError(msg);
    expect(result.isPermissionError).toBe(true);
    expect(result.missingActions).toContain('iam:CreateServiceLinkedRole');
  });

  it('detects "not authorized to perform" pattern', () => {
    const msg =
      'User: arn:aws:sts::123456789012:assumed-role/OpenComp-Remediator/session is not authorized to perform: guardduty:CreateDetector on resource: *';
    const result = parseAwsPermissionError(msg);
    expect(result.isPermissionError).toBe(true);
    expect(result.missingActions).toContain('guardduty:CreateDetector');
  });

  it('detects AccessDeniedException', () => {
    const msg =
      'AccessDeniedException: User is not authorized to perform: kms:EnableKeyRotation';
    const result = parseAwsPermissionError(msg);
    expect(result.isPermissionError).toBe(true);
    expect(result.missingActions).toContain('kms:EnableKeyRotation');
  });

  it('detects access denied with action', () => {
    const msg = 'Access Denied for action: s3:PutBucketEncryption';
    const result = parseAwsPermissionError(msg);
    expect(result.isPermissionError).toBe(true);
    expect(result.missingActions).toContain('s3:PutBucketEncryption');
  });

  it('captures hyphenated service names instead of truncating them', () => {
    const msg =
      'User: arn:aws:sts::123456789012:assumed-role/OpenComp-Remediator/session is not authorized to perform: cognito-idp:DescribeUserPool with an explicit deny';
    const result = parseAwsPermissionError(msg);
    expect(result.isPermissionError).toBe(true);
    expect(result.missingActions).toEqual(['cognito-idp:DescribeUserPool']);
  });

  it('detects permission error without extractable action', () => {
    const msg = 'Access Denied';
    const result = parseAwsPermissionError(msg);
    expect(result.isPermissionError).toBe(true);
    expect(result.missingActions).toEqual([]);
  });

  it('returns false for non-permission errors', () => {
    const msg = 'ResourceNotFoundException: Detector not found';
    const result = parseAwsPermissionError(msg);
    expect(result.isPermissionError).toBe(false);
    expect(result.missingActions).toEqual([]);
  });

  it('returns false for network errors', () => {
    const msg = 'NetworkingError: connect ECONNREFUSED';
    const result = parseAwsPermissionError(msg);
    expect(result.isPermissionError).toBe(false);
  });

  it('preserves rawMessage', () => {
    const msg = 'some error with not authorized text';
    const result = parseAwsPermissionError(msg);
    expect(result.rawMessage).toBe(msg);
  });

  it('degrades to non-permission on null/undefined input', () => {
    expect(parseAwsPermissionError(null).isPermissionError).toBe(false);
    expect(parseAwsPermissionError(undefined).missingActions).toEqual([]);
  });
});

describe('parseAzurePermissionError', () => {
  it('returns a non-permission object (not null) for unrelated errors', () => {
    const result = parseAzurePermissionError('ResourceNotFound: nothing here');
    expect(result.isPermissionError).toBe(false);
    expect(result.missingActions).toEqual([]);
    expect(result.fixScript).toBeNull();
  });

  it('does not treat a bare 403 id as a permission error', () => {
    const result = parseAzurePermissionError('Request id 403-abc completed');
    expect(result.isPermissionError).toBe(false);
  });

  it('detects real authorization failures and extracts the action', () => {
    const result = parseAzurePermissionError(
      "The client does not have authorization to perform action 'Microsoft.Storage/storageAccounts/write' over scope (403 Forbidden)",
    );
    expect(result.isPermissionError).toBe(true);
    expect(result.missingActions).toEqual([
      'Microsoft.Storage/storageAccounts/write',
    ]);
    expect(result.fixScript).toContain('az role assignment create');
  });
});

describe('parseGcpPermissionError', () => {
  it('degrades to non-permission on null/undefined/empty input', () => {
    expect(parseGcpPermissionError(null).isPermissionError).toBe(false);
    expect(parseGcpPermissionError(undefined).missingPermissions).toEqual([]);
    expect(parseGcpPermissionError('').fixScript).toBeNull();
  });

  it('detects permission_denied and extracts the permission', () => {
    const result = parseGcpPermissionError(
      "Permission denied: caller does not have permission 'storage.buckets.update'",
      'my-project',
    );
    expect(result.isPermissionError).toBe(true);
    expect(result.missingPermissions).toContain('storage.buckets.update');
    expect(result.suggestedRole).toBe('roles/storage.admin');
    expect(result.fixScript).toContain(
      'gcloud projects add-iam-policy-binding',
    );
  });

  it('returns false for unrelated errors', () => {
    const result = parseGcpPermissionError('ResourceNotFound: bucket gone');
    expect(result.isPermissionError).toBe(false);
    expect(result.missingPermissions).toEqual([]);
  });
});
