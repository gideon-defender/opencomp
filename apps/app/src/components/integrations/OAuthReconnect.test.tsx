import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthReconnect } from './OAuthReconnect';

const mocks = vi.hoisted(() => ({
  startOAuth: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
  canCreate: true,
  canUpdate: true,
}));
vi.mock('@/hooks/use-integration-platform', () => ({
  useIntegrationMutations: () => ({ startOAuth: mocks.startOAuth }),
}));
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    hasPermission: (_resource: string, action: string) =>
      action === 'create' ? mocks.canCreate : mocks.canUpdate,
  }),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

const authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=server-state';
const returnUrl = 'https://app.example.com/org-1/cloud-tests?provider=gcp';
const renderReconnect = () =>
  render(<OAuthReconnect connectionId="gcp-1" providerSlug="gcp" providerName="GCP" />);

describe('OAuth reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canCreate = true;
    mocks.canUpdate = true;
    mocks.startOAuth.mockReset();
    mocks.startOAuth.mockResolvedValue({ success: true, authorizationUrl });
    vi.stubGlobal('location', { href: returnUrl, assign: mocks.navigate });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('authorizes the selected connection and navigates to the returned URL', async () => {
    renderReconnect();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect with Google' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(authorizationUrl));
    expect(mocks.startOAuth).toHaveBeenCalledWith('gcp', returnUrl, 'gcp-1');
    expect(screen.getByRole('button', { name: 'Connecting...' })).toBeDisabled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'API failure',
      result: { success: false, error: 'Authorization unavailable' },
      message: 'Authorization unavailable',
    },
    { label: 'missing URL', result: { success: true }, message: 'Failed to start authorization' },
    { label: 'rejected request', result: null, message: 'Failed to start authorization' },
  ])('resets the button and allows retry after $label', async ({ result, message }) => {
    if (result) mocks.startOAuth.mockResolvedValueOnce(result);
    else mocks.startOAuth.mockRejectedValueOnce(new Error('Network failure'));
    renderReconnect();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect with Google' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(message));
    expect(mocks.navigate).not.toHaveBeenCalled();
    const retry = screen.getByRole('button', { name: 'Reconnect with Google' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(authorizationUrl));
    expect(mocks.startOAuth).toHaveBeenCalledTimes(2);
  });

  it('blocks duplicate submissions while the request is pending', async () => {
    let resolveRequest!: (value: { success: boolean; authorizationUrl: string }) => void;
    mocks.startOAuth.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    renderReconnect();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect with Google' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connecting...' }));
    expect(mocks.startOAuth).toHaveBeenCalledTimes(1);
    await act(async () => resolveRequest({ success: true, authorizationUrl }));
    expect(mocks.navigate).toHaveBeenCalledWith(authorizationUrl);
  });

  it.each([
    { canCreate: false, canUpdate: false },
    { canCreate: true, canUpdate: false },
    { canCreate: false, canUpdate: true },
  ])(
    'requires both create and update permissions: $canCreate/$canUpdate',
    ({ canCreate, canUpdate }) => {
      mocks.canCreate = canCreate;
      mocks.canUpdate = canUpdate;
      renderReconnect();
      expect(screen.getByText(/authorize again/)).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(mocks.startOAuth).not.toHaveBeenCalled();
    },
  );
});
