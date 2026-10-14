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

import { TransferOwnership } from './transfer-ownership';

// Owner permissions include organization:delete; admin does not
const OWNER_PERMISSIONS = {
  ...ADMIN_PERMISSIONS,
  organization: ['read', 'update', 'delete'],
};

describe('TransferOwnership permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when user is not the owner', () => {
    setMockPermissions(OWNER_PERMISSIONS);

    const { container } = render(<TransferOwnership isOwner={false} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when user lacks organization:delete permission (admin role)', () => {
    setMockPermissions(ADMIN_PERMISSIONS);

    const { container } = render(<TransferOwnership isOwner={true} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when user lacks organization:delete permission (auditor role)', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);

    const { container } = render(<TransferOwnership isOwner={true} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when user has no permissions at all', () => {
    setMockPermissions({});

    const { container } = render(<TransferOwnership isOwner={true} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders the transfer ownership card when user is owner with organization:delete permission', () => {
    setMockPermissions(OWNER_PERMISSIONS);

    render(<TransferOwnership isOwner={true} />);

    const elements = screen.getAllByText('Transfer ownership');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows read-only Gideon guidance and no transfer action', () => {
    setMockPermissions(OWNER_PERMISSIONS);

    render(<TransferOwnership isOwner={true} />);

    expect(screen.getByText(/Ownership is assigned in Gideon/)).toBeInTheDocument();
    expect(screen.queryByText(/Select new owner/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
