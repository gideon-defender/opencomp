import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AwsAccountSettingsBody } from './aws-account-settings-body';

const state = vi.hoisted(() => ({
  connection: null as unknown,
  isLoading: false,
}));

const mutations = vi.hoisted(() => ({
  updateConnectionCredentials: vi.fn(),
  updateConnectionMetadata: vi.fn(),
  deleteConnection: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/hooks/use-integration-platform', () => ({
  useIntegrationConnection: () => ({
    connection: state.connection,
    isLoading: state.isLoading,
  }),
  useIntegrationMutations: () => mutations,
}));

vi.mock('@gideon-defender/integration-platform', () => ({
  normalizeAwsEnvironment: (value: unknown) => (value === 'aws-us-gov' ? 'aws-us-gov' : 'aws'),
  parseRemediationRolesMap: () => ({}),
}));

vi.mock('@/components/integrations/CredentialInput', () => ({
  CredentialInput: ({
    field,
    value,
    onChange,
  }: {
    field: { id: string };
    value: string | string[];
    onChange: (value: string | string[]) => void;
  }) => (
    <input
      aria-label={field.id}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('@gideon-defender/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@trycompai/design-system', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="alert-icon" />,
  CheckCircle2: () => <span data-testid="check-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
}));

vi.mock('sonner', () => ({
  toast: toastMocks,
}));

vi.mock('./remediation-roles-table', () => ({
  RemediationRolesTable: () => <div data-testid="remediation-roles-table" />,
}));

mockNextIntl();

const provider = {
  credentialFields: [{ id: 'regions', label: 'Regions', type: 'multi-select', options: [] }],
} as never;

function renderBody() {
  return render(
    <AwsAccountSettingsBody open connectionId="conn_aws" provider={provider} orgId="org_1" />,
  );
}

function renderBodyWithAsyncConnection(connection: unknown) {
  // Mimic production: the connection arrives after the first render, which
  // is what triggers the prefill sync (mounting with it already present
  // skips the sync, leaving local state at its initials).
  state.connection = null;
  const view = renderBody();
  state.connection = connection;
  view.rerender(
    <AwsAccountSettingsBody open connectionId="conn_aws" provider={provider} orgId="org_1" />,
  );
  return view;
}

describe('AwsAccountSettingsBody externalId display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isLoading = false;
    state.connection = null;
    mutations.updateConnectionCredentials.mockResolvedValue({ success: true });
    mutations.updateConnectionMetadata.mockResolvedValue({ success: true });
  });

  it('shows the server-minted externalId from metadata, never the org id', () => {
    state.connection = {
      id: 'conn_aws',
      status: 'active',
      createdAt: new Date().toISOString(),
      metadata: {
        connectionName: 'Prod',
        accountId: '123456789012',
        externalId: 'org_org_1_issued',
      },
    };
    renderBody();

    expect(screen.getByText('org_org_1_issued')).toBeInTheDocument();
    expect(screen.queryByText('org_1')).not.toBeInTheDocument();
  });

  it('shows an em dash when no externalId is on file (legacy connection)', () => {
    state.connection = {
      id: 'conn_legacy',
      status: 'active',
      createdAt: new Date().toISOString(),
      metadata: { connectionName: 'Legacy' },
    };
    renderBody();

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the legacy banner and no single-role input for monolith connections', () => {
    state.connection = {
      id: 'conn_legacy',
      status: 'active',
      createdAt: new Date().toISOString(),
      metadata: {
        connectionName: 'Legacy',
        remediationRoleArn: 'arn:aws:iam::123456789012:role/OpenComp-Remediator',
      },
    };
    renderBody();

    // The stored monolith ARN is ignored server-side: the banner points at
    // the pair table, and the removed single-role field stays hidden.
    expect(screen.getByText('awsSettings.legacyRemediationBanner')).toBeInTheDocument();
    expect(screen.queryByLabelText('remediationRoleArn')).not.toBeInTheDocument();
  });

  it('reports an error without a success toast when the metadata update fails', async () => {
    mutations.updateConnectionMetadata.mockResolvedValue({ success: false, error: 'meta boom' });
    state.connection = {
      id: 'conn_aws',
      status: 'active',
      createdAt: new Date().toISOString(),
      metadata: {
        connectionName: 'Prod',
        accountId: '123456789012',
        externalId: 'org_org_1_issued',
        roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
        awsType: 'aws',
      },
    };
    renderBody();

    // First render already carries the connection, so the prefill effect is
    // skipped — type the ARN explicitly like a user edit would.
    fireEvent.change(screen.getByLabelText('roleArn'), {
      target: { value: 'arn:aws:iam::123456789012:role/OpenComp-Auditor' },
    });
    // The credentials-section save is the second save button in DOM order.
    fireEvent.click(screen.getAllByText('awsSettings.save')[1]);
    await waitFor(() => {
      expect(mutations.updateConnectionMetadata).toHaveBeenCalled();
    });
    expect(toastMocks.error).toHaveBeenCalledWith('meta boom');
    expect(toastMocks.success).not.toHaveBeenCalled();
  });
});

describe('AwsAccountSettingsBody environment switch', () => {
  const activeConnection = {
    id: 'conn_aws',
    status: 'active',
    createdAt: new Date().toISOString(),
    metadata: {
      connectionName: 'Prod',
      accountId: '123456789012',
      externalId: 'org_org_1_issued',
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      awsType: 'aws',
      regions: ['us-east-1'],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    state.isLoading = false;
    state.connection = null;
    mutations.updateConnectionCredentials.mockResolvedValue({ success: true });
    mutations.updateConnectionMetadata.mockResolvedValue({ success: true });
  });

  it('sends only the environment so stored regions survive server validation', async () => {
    state.connection = activeConnection;
    renderBody();

    fireEvent.change(screen.getByLabelText('awsType'), {
      target: { value: 'aws-us-gov' },
    });
    // The environment-section save is the first save button in DOM order.
    fireEvent.click(screen.getAllByText('awsSettings.save')[0]);

    await waitFor(() => {
      expect(mutations.updateConnectionCredentials).toHaveBeenCalled();
    });
    // No regions key: sending regions: [] would overwrite the stored picks
    // and fail validation with "No AWS regions selected".
    expect(mutations.updateConnectionCredentials).toHaveBeenCalledWith('conn_aws', {
      awsType: 'aws-us-gov',
    });
    expect(mutations.updateConnectionMetadata).toHaveBeenCalledWith('conn_aws', {
      awsType: 'aws-us-gov',
    });
  });

  it('keeps the region selection when the environment save fails', async () => {
    mutations.updateConnectionCredentials.mockResolvedValueOnce({
      success: false,
      error: 'env boom',
    });
    renderBodyWithAsyncConnection(activeConnection);

    fireEvent.change(screen.getByLabelText('awsType'), {
      target: { value: 'aws-us-gov' },
    });
    fireEvent.click(screen.getAllByText('awsSettings.save')[0]);

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith('env boom');
    });
    expect(toastMocks.success).not.toHaveBeenCalled();

    // The failed save must not wipe the local picks: saving regions still
    // sends the original selection instead of an emptied list.
    mutations.updateConnectionCredentials.mockClear();
    // The scan-regions save is the last save button in DOM order.
    const saves = screen.getAllByText('awsSettings.save');
    fireEvent.click(saves[saves.length - 1]);

    await waitFor(() => {
      expect(mutations.updateConnectionCredentials).toHaveBeenCalledWith('conn_aws', {
        regions: ['us-east-1'],
      });
    });
  });
});
