import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAwsPhase2Credentials,
  defaultAwsConnectionName,
  useAwsTwoStepConnect,
} from './use-aws-two-step-connect';

const mockPost = vi.fn();
const mockUpdateConnectionCredentials = vi.fn();

vi.mock('@/lib/api-client', () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('./use-integration-platform', () => ({
  useIntegrationMutations: () => ({
    updateConnectionCredentials: (...args: unknown[]) => mockUpdateConnectionCredentials(...args),
  }),
}));

describe('defaultAwsConnectionName', () => {
  it('derives AWS <accountId> from the Role ARN', () => {
    expect(defaultAwsConnectionName('arn:aws:iam::123456789012:role/OpenComp-Auditor')).toBe(
      'AWS 123456789012',
    );
  });

  it('falls back to AWS Account when no account id is present', () => {
    expect(defaultAwsConnectionName(undefined)).toBe('AWS Account');
    expect(defaultAwsConnectionName('not-an-arn')).toBe('AWS Account');
  });
});

describe('buildAwsPhase2Credentials', () => {
  it('strips any client externalId and defaults the name from the ARN', () => {
    const shaped = buildAwsPhase2Credentials({
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      externalId: 'lingering-value',
      regions: ['us-east-1'],
    });
    expect(shaped.externalId).toBeUndefined();
    expect(shaped.connectionName).toBe('AWS 123456789012');
    expect(shaped.regions).toEqual(['us-east-1']);
  });

  it('strips the deprecated single remediation role but keeps the pair map', () => {
    const shaped = buildAwsPhase2Credentials({
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      remediationRoleArn: 'arn:aws:iam::123456789012:role/OpenComp-Remediator',
      remediationRoles: '{"Storage:us-east-1":"arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1"}',
    });
    expect(shaped.remediationRoleArn).toBeUndefined();
    expect(shaped.remediationRoles).toBe(
      '{"Storage:us-east-1":"arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1"}',
    );
  });

  it('keeps an explicit connection name', () => {
    const shaped = buildAwsPhase2Credentials({
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      connectionName: 'Prod',
    });
    expect(shaped.connectionName).toBe('Prod');
  });
});

describe('useAwsTwoStepConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts a pending connection and returns the issued externalId', async () => {
    mockPost.mockResolvedValue({
      data: { id: 'conn_pending', status: 'pending', externalId: 'org_org_1_issued' },
    });
    const { result } = renderHook(() =>
      useAwsTwoStepConnect({ providerId: 'aws', orgId: 'org_1' }),
    );

    const started = await result.current.startPendingConnection({
      fields: { awsType: 'aws', regions: ['us-east-1'] },
    });

    expect(mockPost).toHaveBeenCalledWith('/v1/integrations/connections', {
      providerSlug: 'aws',
      organizationId: 'org_1',
      credentials: { awsType: 'aws', regions: ['us-east-1'] },
    });
    expect(started).toEqual({
      success: true,
      id: 'conn_pending',
      externalId: 'org_org_1_issued',
    });
  });

  it('reports start failures without throwing', async () => {
    mockPost.mockResolvedValue({ error: 'boom' });
    const { result } = renderHook(() =>
      useAwsTwoStepConnect({ providerId: 'aws', orgId: 'org_1' }),
    );

    const started = await result.current.startPendingConnection({ fields: {} });
    expect(started.success).toBe(false);
    expect(started.error).toBe('boom');
  });

  it('refuses to start without an organization', async () => {
    const { result } = renderHook(() => useAwsTwoStepConnect({ providerId: 'aws', orgId: '' }));

    const started = await result.current.startPendingConnection({ fields: {} });
    expect(started.success).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('completes phase 2 through updateConnectionCredentials', async () => {
    mockUpdateConnectionCredentials.mockResolvedValue({ success: true });
    const { result } = renderHook(() =>
      useAwsTwoStepConnect({ providerId: 'aws', orgId: 'org_1' }),
    );

    const done = await result.current.completePendingConnection({
      pendingId: 'conn_pending',
      credentials: { roleArn: 'arn:aws:iam::123456789012:role/X' },
    });

    expect(mockUpdateConnectionCredentials).toHaveBeenCalledWith('conn_pending', {
      roleArn: 'arn:aws:iam::123456789012:role/X',
    });
    expect(done.success).toBe(true);
  });

  it('surfaces phase-2 validation errors', async () => {
    mockUpdateConnectionCredentials.mockResolvedValue({
      success: false,
      error: 'Cannot assume the IAM role.',
    });
    const { result } = renderHook(() =>
      useAwsTwoStepConnect({ providerId: 'aws', orgId: 'org_1' }),
    );

    const done = await result.current.completePendingConnection({
      pendingId: 'conn_pending',
      credentials: { roleArn: 'arn:aws:iam::1:role/X' },
    });

    expect(done).toEqual({ success: false, error: 'Cannot assume the IAM role.', notFound: false });
  });

  it('flags a missing pending row so callers can discard the dead ID', async () => {
    mockUpdateConnectionCredentials.mockResolvedValue({
      success: false,
      error: 'Connection conn_pending not found',
    });
    const { result } = renderHook(() =>
      useAwsTwoStepConnect({ providerId: 'aws', orgId: 'org_1' }),
    );

    const done = await result.current.completePendingConnection({
      pendingId: 'conn_pending',
      credentials: { roleArn: 'arn:aws:iam::1:role/X' },
    });

    expect(done).toEqual({
      success: false,
      error: 'Connection conn_pending not found',
      notFound: true,
    });
  });
});
