import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloudConnectionRecovery } from './CloudConnectionRecovery';

const mocks = vi.hoisted(() => ({ status: 'error' }));
vi.mock('@/hooks/use-integration-platform', () => ({
  useIntegrationConnections: () => ({
    connections: [
      {
        id: 'gcp-1',
        providerSlug: 'gcp',
        providerName: 'GCP',
        status: mocks.status,
        authStrategy: 'oauth2',
        errorMessage: 'Google requires reauthentication',
      },
    ],
  }),
}));
vi.mock('@/components/integrations/OAuthReconnect', () => ({
  OAuthReconnect: ({
    errorMessage,
    connectionId,
  }: {
    errorMessage: string;
    connectionId: string;
  }) => (
    <p data-testid="reconnect" data-connection-id={connectionId}>
      {errorMessage}
    </p>
  ),
}));

describe('Cloud connection recovery', () => {
  it('shows the provider error for an errored OAuth connection', () => {
    mocks.status = 'error';
    render(<CloudConnectionRecovery connectionId="gcp-1" />);
    expect(screen.getByText('Google requires reauthentication')).toBeInTheDocument();
    expect(screen.getByTestId('reconnect')).toHaveAttribute('data-connection-id', 'gcp-1');
  });
  it('does not show recovery for healthy connections', () => {
    mocks.status = 'active';
    const { container } = render(<CloudConnectionRecovery connectionId="gcp-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
