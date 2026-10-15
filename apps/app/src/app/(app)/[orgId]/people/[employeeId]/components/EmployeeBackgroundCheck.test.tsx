import { apiClient } from '@/lib/api-client';
import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import type { Member, User } from '@db';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeBackgroundCheck } from './EmployeeBackgroundCheck';

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    hasPermission: (resource: string, action: string) =>
      (resource === 'member' && action === 'update') ||
      (resource === 'organization' && action === 'update'),
  }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const employee = {
  id: 'mem_1',
  userId: 'usr_1',
  organizationId: 'org_1',
  role: 'employee',
  createdAt: new Date(),
  user: {
    id: 'usr_1',
    name: 'Ada Lovelace',
    email: 'ada@work.example',
  },
} as unknown as Member & { user: User };

const activeSubscription = {
  skuKey: 'background_checks_monthly_3',
  status: 'active',
  includedQuantity: 3,
  usedQuantity: 1,
  currentPeriodStart: '2026-04-30T00:00:00.000Z',
  currentPeriodEnd: '2026-05-30T00:00:00.000Z',
  cancelAtPeriodEnd: false,
};

function renderSection(props?: Partial<Parameters<typeof EmployeeBackgroundCheck>[0]>) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <EmployeeBackgroundCheck
        employee={employee}
        organizationId="org_1"
        initialBackgroundCheck={null}
        initialBillingStatus={{
          hasPaymentMethod: true,
          setupAt: null,
          subscriptions: [activeSubscription],
        }}
        backgroundCheckStepEnabled={true}
        memberBackgroundCheckExempt={false}
        {...props}
      />
    </SWRConfig>,
  );
}

mockNextIntl();

describe('EmployeeBackgroundCheck — V1 two-paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get).mockResolvedValue({ data: null, status: 200 });
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        id: 'bcr_1',
        employeeName: 'Ada Lovelace',
        employeeEmail: 'ada@example.com',
        candidateUrl: 'https://identity.gideondefender.com/cand_1',
        status: 'invited',
      },
      status: 200,
    });
  });

  it('renders the two paths with Order selected by default', () => {
    renderSection();

    expect(screen.getByText('How would you like to proceed?')).toBeInTheDocument();
    expect(screen.getByText('Order a new check')).toBeInTheDocument();
    expect(screen.getByText('Attach an existing report')).toBeInTheDocument();
    // IdP-owned user management: exemptions are Gideon-synced, so the
    // exempt path is not offered locally.
    expect(screen.queryByText('Mark as exempt')).not.toBeInTheDocument();
    expect(screen.queryByText('Logs a compliance exception')).not.toBeInTheDocument();

    const orderCard = screen.getByRole('radio', { name: /Order a new check/i });
    expect(orderCard).toHaveAttribute('aria-checked', 'true');

    expect(screen.getByLabelText(/Employee name/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send invite/i })).toBeInTheDocument();
  });

  it('shows the status strip with credits remaining', () => {
    renderSection();

    expect(screen.getByText('backgroundCheck.strip.notStarted.label')).toBeInTheDocument();
    expect(screen.getByText(/backgroundCheck\.strip\.creditsRemaining/)).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /backgroundCheck\.strip\.choosePlan/ }),
    ).toHaveAttribute('href', '/org_1/settings/billing/add-ons/background-checks');
  });

  it('switches to the Attach form when the Attach path is selected', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('radio', { name: /Attach an existing report/i }));

    expect(screen.getByRole('radio', { name: /Attach an existing report/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText(/Drop the file here/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Attach report/i })).toBeDisabled();
  });

  it('does not offer an exempt path (exemptions are Gideon-managed)', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.queryByRole('radio', { name: /Mark as exempt/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Attach an existing report/i }));
    expect(screen.queryByRole('radio', { name: /Mark as exempt/i })).not.toBeInTheDocument();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('always shows the scope panel on both paths', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByText(/What's verified in this check/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Attach an existing report/i }));
    expect(screen.getByText(/What's verified in this check/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Order a new check/i }));
    expect(screen.getByText(/What's verified in this check/)).toBeInTheDocument();
  });

  it('validates personal email before sending the invite', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.type(screen.getByLabelText(/Personal email/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /Send invite/i }));

    expect(
      await screen.findByText('backgroundCheck.main.invalidPersonalEmail'),
    ).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('POSTs the order to /v1/people/:id/background-check', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.type(screen.getByLabelText(/Personal email/), 'ada@example.com');
    await user.type(screen.getByLabelText(/Internal notes/), 'Needs quick turnaround.');
    await user.click(screen.getByRole('button', { name: /Send invite/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/v1/people/mem_1/background-check',
        expect.objectContaining({
          employeeName: 'Ada Lovelace',
          employeeEmail: 'ada@example.com',
          requesterNotes: 'Needs quick turnaround.',
        }),
        'org_1',
      );
    });
  });

  it('disables Send invite when out of credits', () => {
    renderSection({
      initialBillingStatus: {
        hasPaymentMethod: true,
        setupAt: null,
        subscriptions: [{ ...activeSubscription, usedQuantity: 3 }],
      },
    });

    expect(screen.getByRole('button', { name: /Send invite/i })).toBeDisabled();
  });

  it('renders the exempt toggle read-only and never PATCHes the member', async () => {
    const user = userEvent.setup();
    renderSection({ memberBackgroundCheckExempt: true });

    expect(screen.getByText(/backgroundCheck\.main\.exemptNoticeTitle/i)).toBeInTheDocument();
    expect(screen.getByText('Exemption changes are unavailable')).toBeInTheDocument();
    expect(screen.getByText(/does not sync exemption changes from Gideon/i)).toBeInTheDocument();
    expect(screen.queryByText(/Update it in Gideon/i)).not.toBeInTheDocument();

    const toggle = screen.getByRole('switch', { name: /exempt this employee/i });
    // Base UI marks the locked switch with data-disabled (no native disabled attr).
    expect(toggle).toHaveAttribute('data-disabled');

    await user.click(toggle);
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('preserves Order form values when switching paths and returning', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.type(screen.getByLabelText(/Personal email/), 'ada@example.com');
    await user.click(screen.getByRole('radio', { name: /Attach an existing report/i }));
    await user.click(screen.getByRole('radio', { name: /Order a new check/i }));

    expect(screen.getByLabelText(/Personal email/)).toHaveValue('ada@example.com');
  });

  it('renders the bypass notice when backgroundCheckStepEnabled is false', () => {
    render(
      <EmployeeBackgroundCheck
        employee={employee}
        organizationId="org_1"
        initialBackgroundCheck={null}
        initialBillingStatus={{ hasPaymentMethod: false, setupAt: null }}
        backgroundCheckStepEnabled={false}
        memberBackgroundCheckExempt={false}
      />,
    );

    expect(screen.getByText(/background checks are not required/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('does not fetch background-check or billing data when bypassed', async () => {
    render(
      <EmployeeBackgroundCheck
        employee={employee}
        organizationId="org_1"
        initialBackgroundCheck={null}
        initialBillingStatus={{ hasPaymentMethod: false, setupAt: null }}
        backgroundCheckStepEnabled={false}
        memberBackgroundCheckExempt={false}
      />,
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('renders the exempt info card when memberBackgroundCheckExempt is true', () => {
    render(
      <EmployeeBackgroundCheck
        employee={employee}
        organizationId="org_1"
        initialBackgroundCheck={null}
        initialBillingStatus={{ hasPaymentMethod: false, setupAt: null }}
        backgroundCheckStepEnabled={true}
        memberBackgroundCheckExempt={true}
      />,
    );

    expect(screen.getByText(/backgroundCheck\.main\.exemptNoticeTitle/i)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Order a new check/i })).not.toBeInTheDocument();
  });

  it('prefers the org-level bypass over per-member exempt when both are set', () => {
    render(
      <EmployeeBackgroundCheck
        employee={employee}
        organizationId="org_1"
        initialBackgroundCheck={null}
        initialBillingStatus={{ hasPaymentMethod: false, setupAt: null }}
        backgroundCheckStepEnabled={false}
        memberBackgroundCheckExempt={true}
      />,
    );

    expect(
      screen.getByText(/background checks are disabled for your organization/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /exempt this employee/i })).not.toBeInTheDocument();
  });

  it('renders BackgroundCheckAdminActions when a background check record exists', () => {
    const backgroundCheck = {
      id: 'bcr_1',
      employeeName: 'Ada Lovelace',
      employeeEmail: 'ada@example.com',
      requesterNotes: null,
      candidateUrl: 'https://identity.gideondefender.com/cand_1',
      status: 'failed' as const,
      identityStatus: null,
      employmentStatus: null,
      referenceStatus: null,
      rightToWorkStatus: null,
      adjudicationStatus: null,
      lastSyncedAt: null,
      reportSnapshot: null,
      reportSyncedAt: null,
    };

    renderSection({ initialBackgroundCheck: backgroundCheck });

    // Retry is shown for 'failed' status (member:update is mocked as allowed)
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    // The V1 new-check flow must not appear
    expect(screen.queryByText('How would you like to proceed?')).not.toBeInTheDocument();
  });

  it('renders Cancel button when background check is in progress', () => {
    const backgroundCheck = {
      id: 'bcr_2',
      employeeName: 'Ada Lovelace',
      employeeEmail: 'ada@example.com',
      requesterNotes: null,
      candidateUrl: 'https://identity.gideondefender.com/cand_2',
      status: 'in_progress' as const,
      identityStatus: null,
      employmentStatus: null,
      referenceStatus: null,
      rightToWorkStatus: null,
      adjudicationStatus: null,
      lastSyncedAt: null,
      reportSnapshot: null,
      reportSyncedAt: null,
    };

    renderSection({ initialBackgroundCheck: backgroundCheck });

    expect(screen.getByRole('button', { name: /Cancel check/i })).toBeInTheDocument();
    expect(screen.queryByText('How would you like to proceed?')).not.toBeInTheDocument();
  });

  it('reflects the exempt prop when it flips to true', () => {
    const { rerender } = render(
      <EmployeeBackgroundCheck
        employee={employee}
        organizationId="org_1"
        initialBackgroundCheck={null}
        initialBillingStatus={{
          hasPaymentMethod: true,
          setupAt: null,
          subscriptions: [activeSubscription],
        }}
        backgroundCheckStepEnabled={true}
        memberBackgroundCheckExempt={false}
      />,
    );

    // V1 page is rendered (member is not exempt)
    expect(screen.getByText('How would you like to proceed?')).toBeInTheDocument();

    rerender(
      <EmployeeBackgroundCheck
        employee={employee}
        organizationId="org_1"
        initialBackgroundCheck={null}
        initialBillingStatus={{
          hasPaymentMethod: true,
          setupAt: null,
          subscriptions: [activeSubscription],
        }}
        backgroundCheckStepEnabled={true}
        memberBackgroundCheckExempt={true}
      />,
    );

    expect(screen.getByText(/backgroundCheck\.main\.exemptNoticeTitle/i)).toBeInTheDocument();
  });
});
