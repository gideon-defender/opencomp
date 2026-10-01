import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

mockNextIntl();

// Stub the DS Sheet family + controls to simple pass-throughs (render when open).
vi.mock('@trycompai/design-system', () => ({
  Sheet: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetClose: ({ children, ...props }: any) => (
    <button aria-label={props['aria-label']}>{children}</button>
  ),
  SheetBody: ({ children }: any) => <div>{children}</div>,
  SheetFooter: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: (props: any) => <input {...props} />,
}));
vi.mock('@trycompai/design-system/icons', () => ({
  Close: () => <span />,
  Locked: () => <span />,
}));
vi.mock('@/components/VendorLogo', () => ({
  VendorLogo: () => <span data-testid="vendor-logo" />,
}));

// Controllable 2FA status + a stubbed helper (its own data-fetching is tested elsewhere).
const totp = vi.hoisted(() => ({ configured: false, isLoading: false, mutate: vi.fn() }));
vi.mock('../../../tasks/[taskId]/hooks/useTotpStatus', () => ({
  useTotpStatus: () => ({
    configured: totp.configured,
    isLoading: totp.isLoading,
    mutate: totp.mutate,
  }),
}));
vi.mock('../../../tasks/[taskId]/components/browser-automations/MfaSetupHelp', () => ({
  MfaSetupHelp: () => <div data-testid="mfa-help" />,
}));

import type { Connection } from './connection-format';
import { ManageConnectionSheet } from './ManageConnectionSheet';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'bap_1',
    hostname: 'github.com',
    loginIdentity: 'ci-bot@acme.com',
    displayName: 'github.com browser profile',
    status: 'verified',
    vaultProvider: '1password',
    vaultExternalItemRef: 'op://vault/item',
    automationCount: 3,
    ...overrides,
  };
}

const base = {
  open: true,
  onOpenChange: vi.fn(),
  canManage: true,
  canRemove: true,
  busy: false,
  onReconnect: vi.fn(),
  onRename: vi.fn(),
  onChangeLogin: vi.fn(),
  onSetTotp: vi.fn(),
  onClearTotp: vi.fn(),
  onRemove: vi.fn(),
};

describe('ManageConnectionSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    totp.configured = false;
    totp.isLoading = false;
    totp.mutate = vi.fn().mockResolvedValue(undefined);
  });

  it('renders a password connection with its credentials and manage actions', () => {
    render(<ManageConnectionSheet {...base} connection={connection()} />);
    expect(screen.getByText('connections.password')).toBeInTheDocument();
    expect(screen.getByText('connections.securedBy1Password')).toBeInTheDocument();
    expect(screen.getByText('connections.reconnect')).toBeInTheDocument();
    expect(screen.getByText('connections.changeLogin')).toBeInTheDocument();
    expect(screen.getByText('connections.removeEllipsis')).toBeInTheDocument();
  });

  it('hides "Change login" and the credentials row for an SSO connection', () => {
    render(
      <ManageConnectionSheet
        {...base}
        connection={connection({ vaultProvider: null, vaultExternalItemRef: null })}
      />,
    );
    expect(screen.getByText('SSO')).toBeInTheDocument();
    expect(screen.queryByText('connections.securedBy1Password')).not.toBeInTheDocument();
    expect(screen.queryByText('connections.changeLogin')).not.toBeInTheDocument();
    // No stored login → no Automatic 2FA row.
    expect(screen.queryByText('connections.automatic2fa')).not.toBeInTheDocument();
  });

  it('shows a view-only note and no actions when the user can neither manage nor remove', () => {
    render(
      <ManageConnectionSheet
        {...base}
        canManage={false}
        canRemove={false}
        connection={connection()}
      />,
    );
    expect(screen.getByText('connections.viewOnlyMessage')).toBeInTheDocument();
    expect(screen.queryByText('connections.reconnect')).not.toBeInTheDocument();
    expect(screen.queryByText('connections.removeEllipsis')).not.toBeInTheDocument();
  });

  it('lets a delete-only user remove without exposing the manage actions', () => {
    render(
      <ManageConnectionSheet
        {...base}
        canManage={false}
        canRemove={true}
        connection={connection()}
      />,
    );
    // Remove is available (delete permission), but manage-only actions are not.
    expect(screen.getByText('connections.removeEllipsis')).toBeInTheDocument();
    expect(screen.queryByText('connections.reconnect')).not.toBeInTheDocument();
    expect(screen.queryByText('connections.changeLogin')).not.toBeInTheDocument();
    expect(screen.queryByText(/view access/i)).not.toBeInTheDocument();
  });

  it('confirms before removing, warning about dependent automations', () => {
    render(<ManageConnectionSheet {...base} connection={connection({ automationCount: 3 })} />);
    fireEvent.click(screen.getByText('connections.removeEllipsis'));
    expect(screen.getByText('connections.removeConfirmWithAutomations')).toBeInTheDocument();
    expect(screen.getByText('connections.removeButton')).toBeInTheDocument();
  });

  it('surfaces the blocked reason in the header', () => {
    render(
      <ManageConnectionSheet
        {...base}
        connection={connection({ status: 'blocked', blockedReason: 'Verification required' })}
      />,
    );
    expect(screen.getByText('Verification required')).toBeInTheDocument();
  });

  it('shows Automatic 2FA as not set up and saves an added key', async () => {
    render(<ManageConnectionSheet {...base} connection={connection()} />);
    expect(screen.getByText('connections.automatic2fa')).toBeInTheDocument();
    expect(screen.getByText('connections.totpNotSetUp')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('connections.addAuthenticatorKey'));
    });
    const input = screen.getByPlaceholderText(/connections\.authenticatorKeyPlaceholder/i);
    fireEvent.change(input, { target: { value: '  SEED VALUE  ' } });
    await act(async () => {
      fireEvent.click(screen.getByText('connections.saveKey'));
      await waitFor(() => expect(base.onSetTotp).toHaveBeenCalled());
    });

    expect(base.onSetTotp).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bap_1' }),
      'SEED VALUE',
    );
  });

  it('offers Replace / Turn off when Automatic 2FA is on', () => {
    totp.configured = true;
    render(<ManageConnectionSheet {...base} connection={connection()} />);

    expect(screen.getByText(/connections\.totpConfigured/)).toBeInTheDocument();
    expect(screen.getByText('connections.replaceKey')).toBeInTheDocument();

    fireEvent.click(screen.getByText('connections.turnOff'));
    expect(base.onClearTotp).toHaveBeenCalledWith(expect.objectContaining({ id: 'bap_1' }));
  });
});
