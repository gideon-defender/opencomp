import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

mockNextIntl();

import { BatchRemediationDialog } from './BatchRemediationDialog';

vi.mock('../actions/batch-fix', () => ({
  startBatchFix: vi.fn(),
  cancelBatchFix: vi.fn(),
  retryFinding: vi.fn(),
  skipBatchFinding: vi.fn(),
}));

const mockUseRealtimeRun = vi.fn((): { run: unknown } => ({ run: null }));

vi.mock('@gideon-defender/trigger-react', () => ({
  useRealtimeRun: () => mockUseRealtimeRun(),
}));

function finding(id: string, title: string) {
  return { id, title, key: `${id}-key`, severity: 'medium' };
}

function runWithProgress(phase: string, findings: unknown[]) {
  return {
    status: phase === 'done' ? 'COMPLETED' : 'EXECUTING',
    metadata: {
      progress: {
        current: findings.length,
        total: findings.length,
        fixed: phase === 'done' ? findings.length : 0,
        skipped: 0,
        failed: 0,
        findings,
        phase,
      },
    },
  };
}

describe('BatchRemediationDialog pre-start', () => {
  it('lists every finding selected by default', () => {
    render(
      <BatchRemediationDialog
        open
        onOpenChange={() => {}}
        serviceName="S3"
        findings={[finding('f1', 'Public bucket'), finding('f2', 'No versioning')]}
        connectionId="conn-1"
        organizationId="org-1"
      />,
    );
    expect(screen.getByText('Public bucket')).toBeInTheDocument();
    expect(screen.getByText('No versioning')).toBeInTheDocument();
    expect(screen.getByText('cloudTests_batchSelectedForAutoFix')).toBeInTheDocument();
  });
});

describe('BatchRemediationDialog permissions', () => {
  function renderWithResume(progress: { phase: string; findings: unknown[] }) {
    mockUseRealtimeRun.mockReturnValue({ run: runWithProgress(progress.phase, progress.findings) });
    const props = {
      open: true,
      onOpenChange: () => {},
      serviceName: 'S3',
      findings: [finding('f1', 'Public bucket')],
      connectionId: 'conn-1',
      organizationId: 'org-1',
      activeBatch: null as {
        batchId: string;
        triggerRunId: string;
        accessToken: string;
        findings: Array<{ id: string; title: string; status: string; error?: string }>;
      } | null,
    };
    const utils = render(<BatchRemediationDialog {...props} />);
    // The parent loads the active batch async after mount — resume fires
    // on the prop change, same as the page mount path.
    utils.rerender(
      <BatchRemediationDialog
        {...props}
        activeBatch={{
          batchId: 'batch-1',
          triggerRunId: 'run-1',
          accessToken: 'token',
          findings: [{ id: 'f1', title: 'Public bucket', status: 'needs_permissions' }],
        }}
      />,
    );
    return utils;
  }

  it('shows grantable chips and hides blocked actions behind manual review', () => {
    renderWithResume({
      phase: 'waiting_for_permissions',
      findings: [
        {
          id: 'f1',
          title: 'Public bucket',
          status: 'needs_permissions',
          missingPermissions: ['s3:PutBucketEncryption', 'iam:PassRole'],
        },
      ],
    });
    // Grantable action renders as a chip; blocked action never does.
    expect(screen.getByText('PutBucketEncryption')).toBeInTheDocument();
    expect(screen.queryByText('PassRole')).not.toBeInTheDocument();
    expect(screen.getByText(/need manual review/i)).toBeInTheDocument();
    mockUseRealtimeRun.mockReturnValue({ run: null });
  });

  it('hides copy and CloudShell when every action needs manual review', () => {
    renderWithResume({
      phase: 'waiting_for_permissions',
      findings: [
        {
          id: 'f1',
          title: 'Public bucket',
          status: 'needs_permissions',
          missingPermissions: ['iam:PassRole'],
        },
      ],
    });
    expect(screen.getByText(/manual review/i)).toBeInTheDocument();
    expect(screen.queryByText('CloudShell')).not.toBeInTheDocument();
    mockUseRealtimeRun.mockReturnValue({ run: null });
  });
});

describe('BatchRemediationDialog completion', () => {
  it('keeps the Done view when a findings refresh lands after completion', () => {
    mockUseRealtimeRun.mockReturnValue({
      run: runWithProgress('done', [{ id: 'f1', title: 'Public bucket', status: 'fixed' }]),
    });
    const props = {
      open: true,
      onOpenChange: () => {},
      serviceName: 'S3',
      connectionId: 'conn-1',
      organizationId: 'org-1',
      activeBatch: null as {
        batchId: string;
        triggerRunId: string;
        accessToken: string;
        findings: Array<{ id: string; title: string; status: string; error?: string }>;
      } | null,
    };
    const { rerender } = render(
      <BatchRemediationDialog {...props} findings={[finding('f1', 'Public bucket')]} />,
    );
    const resumed = {
      batchId: 'batch-1',
      triggerRunId: 'run-1',
      accessToken: 'token',
      findings: [{ id: 'f1', title: 'Public bucket', status: 'fixed' }],
    };
    rerender(
      <BatchRemediationDialog
        {...props}
        findings={[finding('f1', 'Public bucket')]}
        activeBatch={resumed}
      />,
    );
    expect(screen.getByRole('button', { name: 'cloudTests_batchDone' })).toBeInTheDocument();
    // Parent mutate() rebuilds the findings array while the dialog stays
    // open — the completed run must survive the refresh, not reset.
    rerender(
      <BatchRemediationDialog
        {...props}
        findings={[finding('f1', 'Public bucket updated')]}
        activeBatch={resumed}
      />,
    );
    expect(screen.getByRole('button', { name: 'cloudTests_batchDone' })).toBeInTheDocument();
    mockUseRealtimeRun.mockReturnValue({ run: null });
  });
});
