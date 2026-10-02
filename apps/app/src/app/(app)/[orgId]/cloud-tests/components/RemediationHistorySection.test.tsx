import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const swrMock = vi.fn();

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    useSWR: (_url: string) => swrMock(),
    post: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { RemediationHistorySection } from './RemediationHistorySection';

const FAILED_ACTION = {
  id: 'ract_1',
  remediationKey: 's3-bucket-public',
  resourceId: 'old-backups',
  resourceType: 'S3Bucket',
  status: 'rollback_failed',
  riskLevel: null,
  errorMessage:
    'Rollback failed: User: arn:aws:iam::123456789012:user/deployer is not authorized to perform: s3:PutBucketPolicy',
  initiatedById: 'user_1',
  initiatedByName: 'Ada',
  executedAt: '2026-05-12T10:00:00Z',
  rolledBackAt: null,
  createdAt: '2026-05-12T09:00:00Z',
};

describe('RemediationHistorySection', () => {
  it('shows a generic status instead of the raw provider error', () => {
    swrMock.mockReturnValue({
      data: { data: [FAILED_ACTION], count: 1 },
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<RemediationHistorySection connectionId="conn_1" />);

    expect(screen.getByText('Rollback failed')).toBeInTheDocument();
    expect(screen.queryByText(/arn:aws:iam/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/123456789012/u)).not.toBeInTheDocument();
  });
});
