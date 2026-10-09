import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

mockNextIntl();

const { mockUseIntegrationChecks } = vi.hoisted(() => ({
  mockUseIntegrationChecks: vi.fn(),
}));

vi.mock('../hooks/useIntegrationChecks', () => ({
  useIntegrationChecks: mockUseIntegrationChecks,
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
  }),
}));

vi.mock('@/utils/auth-client', () => ({
  useActiveOrganization: () => ({
    data: { name: 'Test Org' },
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgId: 'org-1', taskId: 'task-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- test mock for next/image intentionally renders img passthrough
  default: (props: any) => <img {...props} />,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

vi.mock('@gideon-defender/ui/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@gideon-defender/ui/button', () => ({
  Button: ({ children, disabled, onClick, title }: any) => (
    <button type="button" disabled={disabled} onClick={onClick} title={title}>
      {children}
    </button>
  ),
}));

vi.mock('@gideon-defender/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({ children }: any) => <span>{children}</span>,
  AlertDialogCancel: ({ children }: any) => <span>{children}</span>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock('@/components/integrations/ConnectIntegrationDialog', () => ({
  ConnectIntegrationDialog: () => null,
}));

vi.mock('@/components/integrations/ManageIntegrationDialog', () => ({
  ManageIntegrationDialog: () => null,
}));

vi.mock('@/components/integrations/MarkExceptionModal', () => ({
  MarkExceptionModal: () => null,
}));

vi.mock('@/components/schedule-picker', () => ({
  SchedulePicker: () => null,
}));

vi.mock('./check-run-history', () => ({
  AccountRunGroups: () => <div data-testid="account-run-groups" />,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import type { TaskIntegrationCheck } from '../hooks/useIntegrationChecks';
import { TaskIntegrationChecks } from './TaskIntegrationChecks';

function gcpCheck(overrides: Partial<TaskIntegrationCheck> = {}): TaskIntegrationCheck {
  return {
    integrationId: 'gcp',
    integrationName: 'Google Cloud Platform',
    integrationLogoUrl: '/gcp.png',
    checkId: 'gcp-check-1',
    checkName: 'GCP CIS check',
    checkDescription: 'Cloud security check',
    isConnected: false,
    isDisabledForTask: false,
    needsConfiguration: false,
    authType: 'oauth2',
    oauthConfigured: false,
    ...overrides,
  };
}

function mockHookState(checks: TaskIntegrationCheck[]) {
  mockUseIntegrationChecks.mockReturnValue({
    checks,
    runs: [],
    lastAttempts: [],
    isLoading: false,
    error: null,
    mutateChecks: vi.fn(),
    mutateRuns: vi.fn(),
    runCheck: vi.fn(),
    revokeException: vi.fn(),
    disconnectCheckFromTask: vi.fn(),
    reconnectCheckToTask: vi.fn(),
  });
}

describe('TaskIntegrationChecks OAuth state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the "OAuth not configured" badge (not "Coming Soon") for a disconnected OAuth integration lacking admin credentials', () => {
    mockHookState([gcpCheck()]);

    render(<TaskIntegrationChecks taskId="task-1" />);

    expect(screen.getByText('Google Cloud Platform')).toBeInTheDocument();
    expect(screen.getByText('integrationChecks.oauthNotConfigured')).toBeInTheDocument();
    expect(screen.queryByText('integrationChecks.comingSoon')).not.toBeInTheDocument();
  });

  it('does not show the badge once OAuth credentials are configured', () => {
    mockHookState([gcpCheck({ oauthConfigured: true })]);

    render(<TaskIntegrationChecks taskId="task-1" />);

    expect(screen.getByText('integrationChecks.connectIntegration')).toBeInTheDocument();
    expect(screen.queryByText('integrationChecks.oauthNotConfigured')).not.toBeInTheDocument();
  });
});
