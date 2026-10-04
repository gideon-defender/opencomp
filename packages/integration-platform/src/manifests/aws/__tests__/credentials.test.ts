import { describe, expect, it } from 'vitest';
import {
  awsCredentialSchema,
  getAwsCloudShellScript,
  getAwsSetupInstructions,
} from '../credentials';

describe('getAwsCloudShellScript', () => {
  it('keeps the YOUR_EXTERNAL_ID placeholder by default', () => {
    const script = getAwsCloudShellScript('aws');
    expect(script).toContain('EXTERNAL_ID="YOUR_EXTERNAL_ID"');
    expect(script).toContain('ROLE_NAME="OpenComp-Auditor"');
  });

  it('injects the issued External ID when provided', () => {
    const script = getAwsCloudShellScript(
      'aws',
      'org_org_abc123_123e4567-e89b-12d3-a456-426614174000',
    );
    expect(script).toContain('EXTERNAL_ID="org_org_abc123_123e4567-e89b-12d3-a456-426614174000"');
    expect(script).not.toContain('YOUR_EXTERNAL_ID');
  });

  it('escapes hostile External IDs so they cannot break out of the assignment', () => {
    const script = getAwsCloudShellScript('aws', 'evil"; rm -rf / # $("x")');
    const line = script.split('\n').find((l) => l.startsWith('EXTERNAL_ID='));
    expect(line).toBe('EXTERNAL_ID="evil\\"; rm -rf / # \\$(\\"x\\")"');
  });

  it('strips newlines from the External ID (no line injection)', () => {
    const script = getAwsCloudShellScript('aws', 'one\nEXTERNAL_ID="x');
    expect(script).not.toContain('\nEXTERNAL_ID="x');
    expect(script).toContain('EXTERNAL_ID="oneEXTERNAL_ID=\\"x"');
  });
});

describe('awsCredentialSchema', () => {
  it('accepts credentials without an externalId (server mints it)', () => {
    const result = awsCredentialSchema.safeParse({
      awsType: 'aws',
      connectionName: 'Pending',
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      regions: ['us-east-1'],
    });
    expect(result.success).toBe(true);
  });

  it('still accepts a stored externalId when present', () => {
    const result = awsCredentialSchema.safeParse({
      awsType: 'aws',
      connectionName: 'Prod',
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      externalId: 'org_org_abc123_123e4567-e89b-12d3-a456-426614174000',
      regions: ['us-east-1'],
    });
    expect(result.success).toBe(true);
  });
});

describe('getAwsSetupInstructions', () => {
  it('tells the customer the External ID is already on file', () => {
    const text = getAwsSetupInstructions('aws');
    expect(text).toContain('already on file');
    expect(text).not.toContain('your OpenComp organization ID');
  });

  it('injects the issued External ID when provided', () => {
    const text = getAwsSetupInstructions(
      'aws',
      'org_org_abc123_123e4567-e89b-12d3-a456-426614174000',
    );
    expect(text).toContain('EXTERNAL_ID="org_org_abc123_123e4567-e89b-12d3-a456-426614174000"');
    expect(text).not.toContain('EXTERNAL_ID="YOUR_EXTERNAL_ID"');
  });

  it('escapes hostile External IDs so they cannot break out of the assignment', () => {
    const text = getAwsSetupInstructions('aws', 'evil"; rm -rf / # $("x")');
    expect(text).not.toContain('evil"; rm -rf');
    expect(text).toContain('evil\\"; rm -rf');
  });
});
