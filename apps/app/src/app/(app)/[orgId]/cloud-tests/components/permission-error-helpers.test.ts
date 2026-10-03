import { describe, expect, it } from 'vitest';

import {
  buildAwsFixScript,
  detectServiceLinkedRole,
  extractActionsFromError,
  isAzureError,
  isGcpError,
  isPermissionErrorMessage,
} from './permission-error-helpers';

describe('isPermissionErrorMessage', () => {
  it.each([
    'User is not authorized to perform: s3:ListBucket',
    'AccessDenied: not authorized',
    'Access Denied: User is not authorized to perform s3:ListBucket',
    'UnauthorizedAccess: missing credentials',
    'AuthorizationFailed: role assignment missing',
    'User x does not have authorization to perform action',
    'User x does not have serviceusage.services.use access',
    "permission 'iam.serviceAccounts.actAs' denied",
    'Error 403: Forbidden when calling the API',
    'PERMISSION_DENIED: missing GCP permission',
    'you do not have the required iam:PassRole permission',
  ])('detects a permission error: %s', (error) => {
    expect(isPermissionErrorMessage(error)).toBe(true);
  });

  it.each([
    'BucketAlreadyOwnedByYou: you own this bucket',
    'NoSuchBucket: the specified bucket does not exist',
    'Throttling: rate exceeded, retry later',
    'Invalid parameter: Bucket must be a valid bucket name',
    'An unexpected error occurred',
    'Permission field is required',
    '',
  ])('does not misclassify operational errors: %s', (error) => {
    expect(isPermissionErrorMessage(error)).toBe(false);
  });

  it('does not treat a bare provider-host mention as a permission error', () => {
    expect(isPermissionErrorMessage('Sync failed for https://management.azure.com/jobs/42')).toBe(
      false,
    );
  });
});

describe('extractActionsFromError', () => {
  it('extracts AWS actions from not-authorized messages', () => {
    expect(
      extractActionsFromError('not authorized to perform: cognito-idp:DescribeUserPool'),
    ).toContain('cognito-idp:DescribeUserPool');
  });

  it('extracts GCP permissions from does-not-have-access messages', () => {
    expect(
      extractActionsFromError('User x does not have serviceusage.services.use access'),
    ).toContain('serviceusage.services.use');
  });

  it('returns an empty list when nothing parses', () => {
    expect(extractActionsFromError('Access Denied: blocked with no tokens')).toEqual([]);
  });
});

describe('detectServiceLinkedRole', () => {
  it('matches guardduty, inspector, and macie variants', () => {
    for (const service of ['guardduty', 'inspector', 'macie']) {
      expect(
        detectServiceLinkedRole(`AccessDenied: ${service} needs its service-linked role`),
      ).not.toBeNull();
    }
  });

  it('returns null without a service-linked-role mention', () => {
    expect(detectServiceLinkedRole('AccessDenied: s3:ListBucket')).toBeNull();
  });

  it('does not match "configuration" as AWS Config', () => {
    // GuardDuty-flavored error mentioning "configuration": the config
    // pattern must not claim it — GuardDuty's own pattern owns it.
    const match = detectServiceLinkedRole(
      'AccessDenied: guardduty configuration needs its service-linked role',
    );
    expect(match?.service).toBe('GuardDuty');
  });
});

describe('buildAwsFixScript', () => {
  it('returns null for an empty action list', () => {
    expect(buildAwsFixScript([])).toBeNull();
  });

  it('returns guidance (not a grant) when every action is blocked', () => {
    const script = buildAwsFixScript(['iam:PassRole']);
    expect(script).toMatch(/manual review/i);
    expect(script).not.toContain('put-role-policy');
  });

  it('grants allowed actions and warns about blocked ones', () => {
    const script = buildAwsFixScript(['s3:PutBucketEncryption', 'iam:PassRole']);
    expect(script).toContain('s3:PutBucketEncryption');
    expect(script).toContain('put-role-policy');
    expect(script).toMatch(/WARNING/i);
  });
});

describe('provider detectors', () => {
  it('detects Azure authorization failures but not lookalike hosts', () => {
    expect(isAzureError('AuthorizationFailed: denied')).toBe(true);
    expect(isAzureError('token came from management.azure.com.evil.com')).toBe(false);
  });

  it('detects GCP permission errors but not lookalike hosts', () => {
    expect(isGcpError('PERMISSION_DENIED: missing permission')).toBe(true);
    expect(isGcpError('request to storage.googleapis.com.attacker.example rejected')).toBe(false);
  });
});
