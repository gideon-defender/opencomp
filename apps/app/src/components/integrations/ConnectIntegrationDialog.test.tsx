import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock usePermissions
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

// Mock useParams
vi.mock('next/navigation', () => ({
  useParams: () => ({ orgId: 'org_123' }),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
}));

// --- Integration hooks ---
const dialogMocks = vi.hoisted(() => ({
  createConnection: vi.fn(),
  updateConnectionCredentials: vi.fn(),
  updateConnectionMetadata: vi.fn(),
  apiPost: vi.fn(),
  startOAuth: vi.fn(),
}));
const mockExistingConnections = [
  {
    id: 'conn-1',
    providerSlug: 'aws',
    providerName: 'AWS',
    status: 'active',
    lastSyncAt: null,
    metadata: {
      connectionName: 'AWS Production',
      accountId: '123456789012',
      externalId: 'org_org_123_minted',
      regions: ['us-east-1'],
    },
  },
];

const mockProviders = [
  {
    id: 'aws',
    authType: 'custom',
    setupScript: 'EXTERNAL_ID="YOUR_EXTERNAL_ID"',
    credentialFields: [
      {
        id: 'awsType',
        label: 'AWS Environment',
        type: 'select',
        required: true,
        options: [{ value: 'aws', label: 'Commercial AWS' }],
      },
      {
        id: 'connectionName',
        label: 'Connection Name',
        type: 'text',
        required: true,
        placeholder: 'Name',
      },
      {
        id: 'roleArn',
        label: 'Role ARN',
        type: 'text',
        required: true,
        placeholder: 'arn:...',
      },
      {
        id: 'externalId',
        label: 'External ID',
        type: 'text',
        required: false,
        placeholder: 'Issued automatically',
      },
      {
        id: 'regions',
        label: 'Regions',
        type: 'multi-select',
        required: true,
        options: [{ value: 'us-east-1', label: 'us-east-1' }],
      },
    ],
    supportsMultipleConnections: true,
  },
  {
    // Basic-auth provider whose catalog maps the two fields to API Key / API Secret
    // (the backend synthesizes these credentialFields from usernameField/passwordField).
    id: 'fivetran',
    authType: 'basic',
    credentialFields: [
      {
        id: 'api_key',
        label: 'API Key',
        type: 'text',
        required: true,
        placeholder: 'Enter API Key',
      },
      {
        id: 'api_secret',
        label: 'API Secret',
        type: 'password',
        required: true,
        placeholder: 'Enter API Secret',
      },
    ],
    supportsMultipleConnections: false,
  },
];

vi.mock('@/hooks/use-integration-platform', () => ({
  useIntegrationConnections: () => ({
    connections: mockExistingConnections,
    refresh: vi.fn(),
    isLoading: false,
  }),
  useIntegrationMutations: () => ({
    startOAuth: dialogMocks.startOAuth,
    createConnection: dialogMocks.createConnection,
    deleteConnection: vi.fn(),
    updateConnectionCredentials: dialogMocks.updateConnectionCredentials,
    updateConnectionMetadata: dialogMocks.updateConnectionMetadata,
  }),
  useIntegrationProviders: () => ({
    providers: mockProviders,
    isLoading: false,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    post: (...args: unknown[]) => dialogMocks.apiPost(...args),
  },
}));

// Mock @gideon-defender/ui components
vi.mock('@gideon-defender/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
    className?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@gideon-defender/ui/combobox-dropdown', () => ({
  ComboboxDropdown: () => <div data-testid="combobox" />,
}));

vi.mock('@gideon-defender/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode; className?: string }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode; className?: string }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock('@gideon-defender/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock('@gideon-defender/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode; htmlFor?: string }) => (
    <label>{children}</label>
  ),
}));

vi.mock('@gideon-defender/ui/multiple-selector', () => ({
  default: () => <div data-testid="multi-selector" />,
}));

vi.mock('@gideon-defender/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

vi.mock('@gideon-defender/ui/textarea', () => ({
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="arrow-left-icon" />,
  Check: () => <span data-testid="check-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
  ExternalLink: () => <span data-testid="external-link-icon" />,
  Eye: () => <span />,
  EyeOff: () => <span />,
  Loader2: () => <span data-testid="loader-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Settings: () => <span data-testid="settings-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test mock for next/image must render plain img
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { ConnectIntegrationDialog } from './ConnectIntegrationDialog';

beforeEach(() => {
  window.sessionStorage.clear();
});

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  integrationId: 'aws',
  integrationName: 'Amazon Web Services',
  integrationLogoUrl: 'https://example.com/aws.png',
  onConnected: vi.fn(),
};

describe('ConnectIntegrationDialog permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reauthorizes the selected Google connection instead of submitting empty credentials', async () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    mockProviders.push({
      id: 'gcp',
      authType: 'oauth2',
      credentialFields: [],
      supportsMultipleConnections: false,
    });
    mockExistingConnections.push({
      ...mockExistingConnections[0],
      id: 'gcp-error',
      providerSlug: 'gcp',
      providerName: 'Google Cloud Platform',
      status: 'error',
    });
    try {
      render(
        <ConnectIntegrationDialog
          {...defaultProps}
          integrationId="gcp"
          integrationName="Google Cloud Platform"
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Configure connection' }));
      expect(screen.getByRole('button', { name: 'Reconnect with Google' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Update Connection' })).not.toBeInTheDocument();
      dialogMocks.startOAuth.mockResolvedValueOnce({ success: false, error: 'Unavailable' });
      fireEvent.click(screen.getByRole('button', { name: 'Reconnect with Google' }));
      await waitFor(() =>
        expect(dialogMocks.startOAuth).toHaveBeenCalledWith(
          'gcp',
          window.location.href,
          'gcp-error',
        ),
      );
    } finally {
      mockProviders.pop();
      mockExistingConnections.pop();
    }
  });

  it('shows configure (Settings) button for admin with integration:update', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<ConnectIntegrationDialog {...defaultProps} />);
    expect(screen.getByTestId('settings-icon')).toBeInTheDocument();
  });

  it('hides configure (Settings) button for auditor without integration:update', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<ConnectIntegrationDialog {...defaultProps} />);
    expect(screen.queryByTestId('settings-icon')).not.toBeInTheDocument();
  });

  it('shows delete (Trash) button for admin with integration:delete', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<ConnectIntegrationDialog {...defaultProps} />);
    // Trash icon rendered inside the destructive disconnect button
    expect(screen.getByTestId('trash-icon')).toBeInTheDocument();
  });

  it('hides delete (Trash) button for auditor without integration:delete', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<ConnectIntegrationDialog {...defaultProps} />);
    expect(screen.queryByTestId('trash-icon')).not.toBeInTheDocument();
  });

  it('shows "Add Account" button for admin with integration:create', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<ConnectIntegrationDialog {...defaultProps} />);
    expect(screen.getByText('Add Account')).toBeInTheDocument();
  });

  it('hides "Add Account" button for auditor without integration:create', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<ConnectIntegrationDialog {...defaultProps} />);
    expect(screen.queryByText('Add Account')).not.toBeInTheDocument();
  });

  it('always shows connection info regardless of permissions', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<ConnectIntegrationDialog {...defaultProps} />);
    expect(screen.getByText('Amazon Web Services Connections')).toBeInTheDocument();
    expect(screen.getByText('AWS Production')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<ConnectIntegrationDialog {...defaultProps} open={false} />);
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
  });
});

describe('ConnectIntegrationDialog basic auth credential labels', () => {
  const fivetranProps = {
    ...defaultProps,
    integrationId: 'fivetran',
    integrationName: 'Fivetran',
    integrationLogoUrl: 'https://example.com/fivetran.png',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setMockPermissions(ADMIN_PERMISSIONS);
  });

  // Regression: Fivetran uses Basic auth but the two fields are API Key / API Secret.
  // The form used to hardcode generic Username/Password ids+labels, so customers saw
  // the wrong labels AND their creds were stored under username/password while the
  // runtime read api_key/api_secret → empty Basic header → 401 on every check.
  it('labels basic-auth fields from the catalog (API Key / API Secret), not generic Username / Password', () => {
    render(<ConnectIntegrationDialog {...fivetranProps} />);

    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.getByText('API Secret')).toBeInTheDocument();
    expect(screen.queryByText('Username')).not.toBeInTheDocument();
    expect(screen.queryByText('Password')).not.toBeInTheDocument();
  });
});

describe('ConnectIntegrationDialog AWS server-generated External ID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockPermissions(ADMIN_PERMISSIONS);
  });

  it('asks to generate the External ID first instead of one-shot connecting', () => {
    render(<ConnectIntegrationDialog {...defaultProps} initialView="form" />);

    expect(screen.getByRole('button', { name: /generate external id/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
  });

  it('shows a single phase-1 action beside the script, not a duplicate at the bottom', () => {
    render(<ConnectIntegrationDialog {...defaultProps} initialView="form" />);

    // The phase-1 action sits next to the box it unlocks; the bottom
    // Connect button stays hidden until phase 1 completes.
    const generateButtons = screen.getAllByRole('button', { name: /generate external id/i });
    expect(generateButtons).toHaveLength(1);
    // Placement pin: the action must precede the credential fields. A bottom
    // button follows them, so this fails if the action moves back down.
    // ('Regions' is the last field; 'Role ARN' also matches the script
    // instructions, so it cannot anchor here.)
    const generateButton = generateButtons[0] as HTMLElement;
    const regionsLabel = screen.getByText('Regions');
    expect(generateButton.compareDocumentPosition(regionsLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('moves the action to a bottom Connect button once phase 1 completes', async () => {
    window.sessionStorage.setItem(
      'pending-aws-connection:org_123:aws',
      JSON.stringify({ id: 'conn_pending', externalId: 'org_org_123_restored' }),
    );
    render(<ConnectIntegrationDialog {...defaultProps} initialView="form" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^connect$/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /generate external id/i })).not.toBeInTheDocument();
  });

  it('refuses phase 1 without an AWS environment and makes no request', async () => {
    render(<ConnectIntegrationDialog {...defaultProps} initialView="form" />);

    fireEvent.click(screen.getByRole('button', { name: /generate external id/i }));

    await waitFor(() => {
      expect(screen.getByText('Select an AWS environment first')).toBeInTheDocument();
    });
    expect(dialogMocks.apiPost).not.toHaveBeenCalled();
    expect(dialogMocks.createConnection).not.toHaveBeenCalled();
  });

  it('shows the environment-first message with no expand toggle before an environment is picked', () => {
    render(<ConnectIntegrationDialog {...defaultProps} initialView="form" />);

    // Pre-selection every script box is disabled by design — each must say
    // which step unblocks it, and none may offer a toggle that does nothing.
    const messages = screen.getAllByText(
      'Select an AWS environment before copying the setup script.',
    );
    expect(messages.length).toBeGreaterThan(1);
    expect(screen.queryByRole('button', { name: /show full script/i })).not.toBeInTheDocument();
  });

  it('resumes a stored pending connection instead of minting a duplicate', async () => {
    window.sessionStorage.setItem(
      'pending-aws-connection:org_123:aws',
      JSON.stringify({ id: 'conn_pending', externalId: 'org_org_123_restored' }),
    );
    render(<ConnectIntegrationDialog {...defaultProps} initialView="form" />);

    // Already past phase 1: no generate step, no new request.
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /generate external id/i }),
      ).not.toBeInTheDocument();
    });
    expect(dialogMocks.apiPost).not.toHaveBeenCalled();
    expect(dialogMocks.createConnection).not.toHaveBeenCalled();
  });

  it('never sends a client externalId when saving credentials in the configure view', async () => {
    render(<ConnectIntegrationDialog {...defaultProps} />);

    // Open configure for the existing connection (prefill carries the
    // server-minted externalId, but the PUT must not send it back).
    fireEvent.click(screen.getByTestId('settings-icon'));
    fireEvent.click(screen.getByRole('button', { name: /update connection/i }));

    await waitFor(() => {
      expect(dialogMocks.updateConnectionCredentials).toHaveBeenCalled();
    });
    const sent = dialogMocks.updateConnectionCredentials.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(sent.externalId).toBeUndefined();
  });

  it('offers Start over to discard a stored pending connection', async () => {
    window.sessionStorage.setItem(
      'pending-aws-connection:org_123:aws',
      JSON.stringify({ id: 'conn_pending', externalId: 'org_org_123_stored' }),
    );
    render(<ConnectIntegrationDialog {...defaultProps} initialView="form" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /start over/i }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem('pending-aws-connection:org_123:aws')).toBeNull();
    });
    // Back at phase 1 with no duplicate mint.
    expect(screen.getByRole('button', { name: /generate external id/i })).toBeInTheDocument();
    expect(dialogMocks.apiPost).not.toHaveBeenCalled();
  });

  it('hides the server-owned External ID field in the configure view', () => {
    render(<ConnectIntegrationDialog {...defaultProps} />);

    // Open configure for the existing connection. The External ID is minted
    // server-side and pinned on update, so no editable field may render —
    // the save path strips any client value and would silently discard edits.
    fireEvent.click(screen.getByTestId('settings-icon'));

    expect(screen.queryByText('External ID')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('org_org_123_minted')).not.toBeInTheDocument();
    // Editable fields still render.
    expect(screen.getByText('Role ARN')).toBeInTheDocument();
  });

  it('offers per-pair remediation setup and never the deprecated single role field', () => {
    render(<ConnectIntegrationDialog {...defaultProps} initialView="form" />);

    // The deprecated monolith field must not render in the new-connection
    // form — the server rejects it with 400, so offering it funnels users
    // into a dead end. The per-pair flow renders instead.
    expect(screen.queryByText('Remediation Role ARN')).not.toBeInTheDocument();
    expect(screen.getByText('Auto-Remediation (Optional)')).toBeInTheDocument();
    expect(screen.getByText('Asset class')).toBeInTheDocument();
  });
});
