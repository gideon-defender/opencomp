import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

mockNextIntl();

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
    post: vi.fn(),
  }),
}));

// Mock ConnectIntegrationDialog
vi.mock('@/components/integrations/ConnectIntegrationDialog', () => ({
  ConnectIntegrationDialog: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    integrationId: string;
    integrationName: string;
    integrationLogoUrl: string;
    onConnected?: () => void;
  }) => (open ? <div data-testid="connect-dialog" /> : null),
}));

// Mock design system components
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
  PageHeader: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
  PageLayout: ({
    children,
    header,
  }: {
    children: React.ReactNode;
    header?: React.ReactNode;
    variant?: string;
    fillHeight?: boolean;
    padding?: string;
    maxWidth?: string;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
  Spinner: () => <span data-testid="spinner" />,
  Input: (props: Record<string, unknown>) => <input {...props} />,
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

vi.mock('@trycompai/design-system/icons', () => ({
  ArrowLeft: () => <span data-testid="arrow-left-icon" />,
  CheckmarkFilled: () => <span data-testid="checkmark-icon" />,
  Launch: () => <span data-testid="launch-icon" />,
}));

// Mock @gideon-defender/ui components
vi.mock('@gideon-defender/ui/card', () => ({
  Card: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <div
      data-testid="card"
      onClick={onClick}
      className={className}
      role={onClick ? 'button' : undefined}
    >
      {children}
    </div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@gideon-defender/ui/multiple-selector', () => ({
  default: () => <div data-testid="multi-selector" />,
}));

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
  },
}));

import { EmptyState } from './EmptyState';

const defaultProps = {
  onBack: undefined,
  connectedProviders: [] as string[],
  onConnected: vi.fn(),
  initialProvider: null as 'aws' | 'gcp' | 'azure' | null,
};

describe('EmptyState permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders provider cards as clickable for admin with integration:create', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<EmptyState {...defaultProps} />);
    const cards = screen.getAllByTestId('card');
    // Admin cards should have cursor-pointer class (not cursor-not-allowed)
    for (const card of cards) {
      expect(card.className).toContain('cursor-pointer');
      expect(card.className).not.toContain('cursor-not-allowed');
    }
  });

  it('renders provider cards as non-clickable for auditor without integration:create', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<EmptyState {...defaultProps} />);
    const cards = screen.getAllByTestId('card');
    for (const card of cards) {
      expect(card.className).toContain('cursor-not-allowed');
    }
  });

  it('opens ConnectIntegrationDialog for GCP provider for auditor', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<EmptyState {...defaultProps} initialProvider="gcp" />);
    expect(screen.getByTestId('connect-dialog')).toBeInTheDocument();
  });

  it('opens ConnectIntegrationDialog for GCP provider for admin', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<EmptyState {...defaultProps} initialProvider="gcp" />);
    expect(screen.getByTestId('connect-dialog')).toBeInTheDocument();
  });

  it('opens ConnectIntegrationDialog for AWS provider for admin', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<EmptyState {...defaultProps} initialProvider="aws" />);
    expect(screen.getByTestId('connect-dialog')).toBeInTheDocument();
  });

  it('always shows cloud provider options regardless of permissions', () => {
    setMockPermissions({});
    render(<EmptyState {...defaultProps} />);
    expect(screen.getByText('AWS')).toBeInTheDocument();
    expect(screen.getByText('GCP')).toBeInTheDocument();
    expect(screen.getByText('Azure')).toBeInTheDocument();
  });
});
