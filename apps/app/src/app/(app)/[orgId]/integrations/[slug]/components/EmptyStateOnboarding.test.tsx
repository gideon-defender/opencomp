import type { IntegrationProvider } from '@/hooks/use-integration-platform';
import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmptyStateOnboarding } from './EmptyStateOnboarding';

const mockCreateConnection = vi.fn();
const mockUpdateConnectionCredentials = vi.fn();
const mockApiPost = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('@/hooks/use-integration-platform', () => ({
  useIntegrationConnections: () => ({
    connections: [],
    refresh: vi.fn(),
    isLoading: false,
  }),
  useIntegrationMutations: () => ({
    createConnection: mockCreateConnection,
    updateConnectionCredentials: mockUpdateConnectionCredentials,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  api: {
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

vi.mock('@/components/integrations/CloudShellSetup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/integrations/CloudShellSetup')>();
  return {
    ...actual,
    CloudShellSetup: ({
      externalId,
      disabledMessage,
    }: {
      externalId: string;
      disabledMessage?: string;
    }) => (
      <div
        data-testid="cloud-shell-setup"
        data-external-id={externalId}
        data-disabled-message={disabledMessage ?? ''}
      />
    ),
  };
});

vi.mock('@/components/integrations/CredentialInput', () => ({
  CredentialInput: ({ field, value, onChange }: any) => (
    <input
      aria-label={field.label}
      value={Array.isArray(value) ? value.join(',') : (value ?? '')}
      onChange={(event) =>
        onChange(
          field.type === 'multi-select'
            ? event.target.value.split(',').filter(Boolean)
            : event.target.value,
        )
      }
    />
  ),
}));

vi.mock('@trycompai/design-system', () => ({
  Button: ({ children, disabled, loading, onClick }: any) => (
    <button disabled={disabled || loading} onClick={onClick} type="button">
      {children}
    </button>
  ),
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('lucide-react', () => ({
  ArrowRight: () => <span data-testid="arrow-right-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  Cloud: () => <span data-testid="cloud-icon" />,
  ShieldCheck: () => <span data-testid="shield-check-icon" />,
}));

vi.mock('@gideon-defender/integration-platform', () => ({
  awsRemediationScript: '',
  getAwsCloudShellUrl: () => 'https://console.aws.amazon.com/cloudshell',
  getAwsCloudShellScript: () => '',
  getAwsRemediationScript: () => '',
  normalizeAwsEnvironment: (value: unknown) => (value === 'aws-us-gov' ? 'aws-us-gov' : 'aws'),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

mockNextIntl();

describe('EmptyStateOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('allows connecting dynamic custom integrations with no credential fields', async () => {
    mockCreateConnection.mockResolvedValue({ success: true });
    const onConnected = vi.fn();

    render(
      <EmptyStateOnboarding
        provider={
          {
            id: 'dynamic-security',
            slug: 'dynamic-security',
            name: 'Dynamic Security',
            description: 'Dynamic integration',
            category: 'Security',
            logoUrl: '',
            authType: 'custom',
            capabilities: ['checks'],
            isActive: true,
            docsUrl: 'https://example.com/docs',
          } as unknown as IntegrationProvider
        }
        orgId="org_1"
        onConnected={onConnected}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /connect account/i }));

    await waitFor(() => {
      expect(mockCreateConnection).toHaveBeenCalledWith('dynamic-security', {});
    });
    expect(onConnected).toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('onboarding.connected'));
  });

  it('uses API key fallback field when credential fields are missing', async () => {
    mockCreateConnection.mockResolvedValue({ success: true });

    render(
      <EmptyStateOnboarding
        provider={
          {
            id: 'dynamic-api',
            slug: 'dynamic-api',
            name: 'Dynamic API',
            description: 'Dynamic API integration',
            category: 'Security',
            logoUrl: '',
            authType: 'api_key',
            capabilities: ['checks'],
            isActive: true,
          } as unknown as IntegrationProvider
        }
        orgId="org_1"
        onConnected={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /connect account/i }));
    expect(screen.getByText('onboarding.fieldRequired')).toBeInTheDocument();
    expect(mockCreateConnection).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('onboarding.apiKey'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /connect account/i }));

    await waitFor(() => {
      expect(mockCreateConnection).toHaveBeenCalledWith('dynamic-api', { api_key: 'secret' });
    });
  });

  describe('AWS server-generated External ID two-step', () => {
    const awsProvider = {
      id: 'aws',
      slug: 'aws',
      name: 'AWS',
      description: 'AWS integration',
      category: 'Cloud',
      logoUrl: '',
      authType: 'custom',
      capabilities: ['checks'],
      isActive: true,
      docsUrl: 'https://example.com/docs',
      setupScript: 'EXTERNAL_ID="YOUR_EXTERNAL_ID"',
      credentialFields: [
        { id: 'awsType', label: 'AWS Environment', type: 'select', required: true },
        { id: 'roleArn', label: 'Role ARN', type: 'text', required: true },
        { id: 'externalId', label: 'External ID', type: 'text', required: false },
        { id: 'regions', label: 'Regions', type: 'multi-select', required: true },
      ],
    } as unknown as IntegrationProvider;

    function renderAws(onConnected = vi.fn()) {
      render(
        <EmptyStateOnboarding provider={awsProvider} orgId="org_1" onConnected={onConnected} />,
      );
      return { onConnected };
    }

    it('mints a pending connection first and never sends a client externalId', async () => {
      mockApiPost.mockResolvedValue({
        data: { id: 'conn_pending', status: 'pending', externalId: 'org_org_1_issued' },
      });
      mockUpdateConnectionCredentials.mockResolvedValue({ success: true });
      const { onConnected } = renderAws();

      // Phase 1 requires the environment before minting.
      fireEvent.click(screen.getByRole('button', { name: /generate external id/i }));
      expect(screen.getByText('Select an AWS environment first')).toBeInTheDocument();
      expect(mockApiPost).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('AWS Environment'), { target: { value: 'aws' } });
      fireEvent.click(screen.getByRole('button', { name: /generate external id/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith('/v1/integrations/connections', {
          providerSlug: 'aws',
          organizationId: 'org_1',
          credentials: expect.objectContaining({ awsType: 'aws' }),
        });
      });
      // No client-chosen externalId or Role ARN leaves the browser in phase 1.
      const phase1Body = mockApiPost.mock.calls[0][1] as { credentials: Record<string, unknown> };
      expect(phase1Body.credentials.externalId).toBeUndefined();
      expect(phase1Body.credentials.roleArn).toBeUndefined();

      // Phase 2 completes the pending connection without any externalId.
      fireEvent.change(screen.getByLabelText('Role ARN'), {
        target: { value: 'arn:aws:iam::123456789012:role/OpenComp-Auditor' },
      });
      fireEvent.change(screen.getByLabelText('Regions'), { target: { value: 'us-east-1' } });
      fireEvent.click(screen.getByRole('button', { name: /connect account/i }));

      await waitFor(() => {
        expect(mockUpdateConnectionCredentials).toHaveBeenCalledWith(
          'conn_pending',
          expect.objectContaining({
            roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
            regions: ['us-east-1'],
          }),
        );
      });
      const phase2Creds = mockUpdateConnectionCredentials.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(phase2Creds.externalId).toBeUndefined();
      expect(mockCreateConnection).not.toHaveBeenCalled();
      expect(onConnected).toHaveBeenCalled();
    });

    it('injects the minted externalId into the setup script after phase 1', async () => {
      mockApiPost.mockResolvedValue({
        data: { id: 'conn_pending', status: 'pending', externalId: 'org_org_1_issued' },
      });
      mockUpdateConnectionCredentials.mockResolvedValue({ success: true });
      renderAws();

      fireEvent.change(screen.getByLabelText('AWS Environment'), { target: { value: 'aws' } });
      fireEvent.click(screen.getByRole('button', { name: /generate external id/i }));

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalled();
      });
      // Every setup script on screen carries the issued value — never the placeholder.
      const scripts = screen.getAllByTestId('cloud-shell-setup');
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) {
        expect(script).toHaveAttribute('data-external-id', 'org_org_1_issued');
      }
    });

    it('shows the environment-first message until an environment is picked', () => {
      renderAws();

      // Pre-selection no script claims Generate is the next step — each box
      // falls back to the component's environment-first default.
      const scripts = screen.getAllByTestId('cloud-shell-setup');
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) {
        expect(script).toHaveAttribute('data-disabled-message', '');
      }

      // Picking the environment (without generating) switches every script
      // to the Generate-first instruction.
      fireEvent.change(screen.getByLabelText('AWS Environment'), { target: { value: 'aws' } });
      for (const script of screen.getAllByTestId('cloud-shell-setup')) {
        expect(script.getAttribute('data-disabled-message')).toContain('Generate');
      }
    });

    it('restores the pending connection from storage instead of minting again', async () => {
      window.sessionStorage.setItem(
        'pending-aws-connection:org_1:aws',
        JSON.stringify({ id: 'conn_pending', externalId: 'org_org_1_restored' }),
      );
      mockUpdateConnectionCredentials.mockResolvedValue({ success: true });
      const { onConnected } = renderAws();

      // Already past phase 1: the CTA completes, it does not mint.
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /connect account/i })).toBeInTheDocument();
      });
      expect(mockApiPost).not.toHaveBeenCalled();
      const scripts = screen.getAllByTestId('cloud-shell-setup');
      for (const script of scripts) {
        expect(script).toHaveAttribute('data-external-id', 'org_org_1_restored');
      }

      // Phase 2 validates every required field, including the environment
      // (selecting it first: changing it later resets the regions).
      fireEvent.change(screen.getByLabelText('AWS Environment'), { target: { value: 'aws' } });
      fireEvent.change(screen.getByLabelText('Role ARN'), {
        target: { value: 'arn:aws:iam::123456789012:role/OpenComp-Auditor' },
      });
      fireEvent.change(screen.getByLabelText('Regions'), { target: { value: 'us-east-1' } });
      fireEvent.click(screen.getByRole('button', { name: /connect account/i }));

      await waitFor(() => {
        expect(mockUpdateConnectionCredentials).toHaveBeenCalledWith(
          'conn_pending',
          expect.not.objectContaining({ externalId: expect.anything() }),
        );
      });
      expect(onConnected).toHaveBeenCalled();
    });

    it('discards a dead pending row on not-found and returns to phase 1', async () => {
      window.sessionStorage.setItem(
        'pending-aws-connection:org_1:aws',
        JSON.stringify({ id: 'conn_dead', externalId: 'org_org_1_dead' }),
      );
      mockUpdateConnectionCredentials.mockResolvedValue({
        success: false,
        error: 'Connection conn_dead not found',
      });
      renderAws();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /connect account/i })).toBeInTheDocument();
      });
      fireEvent.change(screen.getByLabelText('AWS Environment'), { target: { value: 'aws' } });
      fireEvent.change(screen.getByLabelText('Role ARN'), {
        target: { value: 'arn:aws:iam::123456789012:role/OpenComp-Auditor' },
      });
      fireEvent.change(screen.getByLabelText('Regions'), { target: { value: 'us-east-1' } });
      fireEvent.click(screen.getByRole('button', { name: /connect account/i }));

      // The dead ID is dropped — the next click mints fresh instead of
      // retrying the same dead row forever.
      await waitFor(() => {
        expect(window.sessionStorage.getItem('pending-aws-connection:org_1:aws')).toBeNull();
      });
      expect(screen.getByRole('button', { name: /generate external id/i })).toBeInTheDocument();
      expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('no longer exists'));
    });

    it('offers Start over to discard the pending connection', async () => {
      window.sessionStorage.setItem(
        'pending-aws-connection:org_1:aws',
        JSON.stringify({ id: 'conn_pending', externalId: 'org_org_1_stored' }),
      );
      renderAws();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /start over/i }));

      await waitFor(() => {
        expect(window.sessionStorage.getItem('pending-aws-connection:org_1:aws')).toBeNull();
      });
      expect(screen.getByRole('button', { name: /generate external id/i })).toBeInTheDocument();
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });
});
