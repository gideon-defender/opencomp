import type { Finding } from '@/hooks/use-findings-api';
import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  NO_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

mockNextIntl();

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ permissions: {}, hasPermission: mockHasPermission }),
}));

// FindingsTab fetches the org's enabled frameworks via useApiSWR to build the
// framework filter. Stub it so these tests don't hit the real SWR hook (which
// reaches for next/navigation's useParams).
vi.mock('@/hooks/use-api-swr', () => ({
  useApiSWR: () => ({ data: undefined }),
}));

const mockUseOrganizationFindings = vi.fn();
vi.mock('@/hooks/use-findings-api', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-findings-api')>(
    '@/hooks/use-findings-api',
  );
  return {
    ...actual,
    useOrganizationFindings: (...args: unknown[]) => mockUseOrganizationFindings(...args),
  };
});

vi.mock('./CreateFindingSheet', () => ({
  CreateFindingSheet: ({ open }: { open: boolean }) => (
    <div data-testid="create-sheet" data-open={open} />
  ),
}));

vi.mock('./FindingDetailSheet', () => ({
  FindingDetailSheet: ({ open }: { open: boolean }) => (
    <div data-testid="detail-sheet" data-open={open} />
  ),
}));

vi.mock('./FindingTemplateManager', () => ({
  FindingTemplateManager: ({ open }: { open: boolean }) => (
    <div data-testid="template-manager" data-open={open} />
  ),
}));

import { FindingsTab } from './FindingsTab';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'fnd_1',
    type: 'soc2',
    status: 'open',
    severity: 'medium',
    content: 'Evidence missing a timestamp',
    revisionNote: null,
    area: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-02T00:00:00Z',
    taskId: 'tsk_1',
    evidenceSubmissionId: null,
    evidenceFormType: null,
    policyId: null,
    vendorId: null,
    riskId: null,
    memberId: null,
    deviceId: null,
    templateId: null,
    createdById: 'mem_1',
    organizationId: 'org_1',
    createdBy: null,
    createdByAdmin: null,
    template: null,
    task: { id: 'tsk_1', title: 'Upload MFA evidence' },
    evidenceSubmission: null,
    policy: null,
    vendor: null,
    risk: null,
    member: null,
    device: null,
    ...overrides,
  };
}

describe('FindingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the empty state when no findings are returned', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    mockUseOrganizationFindings.mockReturnValue({
      data: { data: [], status: 200 },
      mutate: vi.fn(),
    });

    render(<FindingsTab organizationId="org_1" />);

    expect(screen.getByText('findings.emptyTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'findings.manageTemplates' }));
    expect(screen.getByTestId('template-manager')).toHaveAttribute('data-open', 'true');
  });

  it('renders the linked item title', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    mockUseOrganizationFindings.mockReturnValue({
      data: { data: [makeFinding()], status: 200 },
      mutate: vi.fn(),
    });

    render(<FindingsTab organizationId="org_1" />);

    expect(screen.getByText('findings.taskTarget')).toBeInTheDocument();
    expect(screen.getByText(/evidence missing a timestamp/i)).toBeInTheDocument();
  });

  it('does not render the CreateFindingSheet mount for users without finding:create (admin)', () => {
    // Admins no longer have finding:create — sheet is only mounted for auditors
    setMockPermissions(ADMIN_PERMISSIONS);
    mockUseOrganizationFindings.mockReturnValue({
      data: { data: [], status: 200 },
      mutate: vi.fn(),
    });

    render(<FindingsTab organizationId="org_1" />);

    expect(screen.queryByTestId('create-sheet')).not.toBeInTheDocument();
  });

  it('renders the CreateFindingSheet mount for auditors', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    mockUseOrganizationFindings.mockReturnValue({
      data: { data: [], status: 200 },
      mutate: vi.fn(),
    });

    render(<FindingsTab organizationId="org_1" />);

    expect(screen.getByTestId('create-sheet')).toBeInTheDocument();
  });

  it('shows the template manager button for member admins', () => {
    // Admins hold finding:update — they manage per-org templates.
    setMockPermissions(ADMIN_PERMISSIONS);
    mockUseOrganizationFindings.mockReturnValue({
      data: { data: [makeFinding()], status: 200 },
      mutate: vi.fn(),
    });

    render(<FindingsTab organizationId="org_1" />);

    expect(screen.getByText('findings.manageTemplates')).toBeInTheDocument();
  });

  it('hides the template manager button without finding:update', () => {
    setMockPermissions(NO_PERMISSIONS);
    mockUseOrganizationFindings.mockReturnValue({
      data: { data: [], status: 200 },
      mutate: vi.fn(),
    });

    render(<FindingsTab organizationId="org_1" />);

    expect(screen.queryByText('findings.manageTemplates')).not.toBeInTheDocument();
  });
});
