import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock usePermissions
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

// Mock useApi hook
vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    delete: vi.fn(),
  }),
}));

// Mock useIntegrationMutations + useIntegrationConnection (the latter is
// used by the AWS scan-mode settings section).
vi.mock('@/hooks/use-integration-platform', () => ({
  useIntegrationMutations: () => ({
    deleteConnection: vi.fn(),
  }),
  useIntegrationConnection: () => ({
    connection: { id: 'conn_test', metadata: {} },
    isLoading: false,
    error: undefined,
    refresh: vi.fn(),
  }),
}));

// Mock @gideon-defender/ui components
vi.mock('@gideon-defender/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@gideon-defender/ui/cn', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@gideon-defender/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode; className?: string }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@gideon-defender/ui/tabs', () => ({
  Tabs: ({
    children,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode; value: string; className?: string }) => (
    <div>{children}</div>
  ),
  TabsList: ({
    children,
  }: {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
  }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode; value: string }) => (
    <div>{children}</div>
  ),
}));

vi.mock('lucide-react', () => ({
  Loader2: () => <span data-testid="loader-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
}));

vi.mock('@trycompai/design-system', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@trycompai/design-system/icons', () => ({
  TrashCan: () => <span data-testid="trash-can-icon" />,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CloudSettingsModal } from './CloudSettingsModal';

const mockProviders = [
  {
    id: 'aws',
    connectionId: 'conn-aws-1',
    name: 'AWS Production',
    status: 'active',
    accountId: '123456789012',
    regions: ['us-east-1'],
    isLegacy: false,
  },
];

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  connectedProviders: mockProviders,
  onUpdate: vi.fn(),
};

mockNextIntl();

describe('CloudSettingsModal permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Disconnect" button for admin with integration:delete permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<CloudSettingsModal {...defaultProps} />);
    expect(screen.getByText('cloudTests_disconnect')).toBeInTheDocument();
  });

  it('hides "Disconnect" button for auditor without integration:delete permission', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<CloudSettingsModal {...defaultProps} />);
    expect(screen.queryByText('cloudTests_disconnect')).not.toBeInTheDocument();
  });

  it('hides "Disconnect" button when user has no permissions', () => {
    setMockPermissions({});
    render(<CloudSettingsModal {...defaultProps} />);
    expect(screen.queryByText('cloudTests_disconnect')).not.toBeInTheDocument();
  });

  it('always shows connection info regardless of permissions', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<CloudSettingsModal {...defaultProps} />);
    expect(screen.getByText('cloudTests_connectionSettings')).toBeInTheDocument();
    expect(screen.getByText('123456789012')).toBeInTheDocument();
  });

  it('always shows connection status regardless of permissions', () => {
    setMockPermissions({});
    render(<CloudSettingsModal {...defaultProps} />);
    expect(screen.getByText('cloudTests_status')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders nothing when connectedProviders is empty', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    const { container } = render(<CloudSettingsModal {...defaultProps} connectedProviders={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('does not render dialog when open is false', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<CloudSettingsModal {...defaultProps} open={false} />);
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
  });

  it('shows the AWS scan-mode switch button when the user has integration:update', () => {
    // Regression guard for the cubic P2: the switch button is an UPDATE
    // operation and must be gated by integration:update, NOT
    // integration:delete. Admin has both, so the button shows.
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<CloudSettingsModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: /cloudTests_switchTo/i })).toBeInTheDocument();
  });

  it('hides the AWS scan-mode switch button for users without integration:update', () => {
    // Auditor has read-only permissions — should not see Switch.
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<CloudSettingsModal {...defaultProps} />);
    expect(screen.queryByRole('button', { name: /cloudTests_switchTo/i })).not.toBeInTheDocument();
  });

  it('shows the AWS scan-mode switch for update-only users (NOT delete users)', () => {
    // The exact regression cubic flagged: a user with integration:update
    // but WITHOUT integration:delete must still see the Switch button,
    // because the API gates this endpoint on integration:update only.
    setMockPermissions({ integration: ['read', 'update'] });
    render(<CloudSettingsModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: /cloudTests_switchTo/i })).toBeInTheDocument();
    // ...and they correctly DO NOT see Disconnect (delete permission required).
    expect(screen.queryByText('cloudTests_disconnect')).not.toBeInTheDocument();
  });
});
