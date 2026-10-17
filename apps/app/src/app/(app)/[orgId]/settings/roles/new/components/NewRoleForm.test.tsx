'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewRoleForm } from './NewRoleForm';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockCreateRole = vi.fn();
vi.mock('../../hooks/useRoles', () => ({
  // Mutation-only component: must not subscribe to the roles list. If it
  // calls useRoles again, this throws and the test fails.
  useRoles: () => {
    throw new Error('NewRoleForm must use useRoleMutations, not useRoles');
  },
  useRoleMutations: () => ({ createRole: mockCreateRole }),
}));

vi.mock('../../components/RoleForm', () => ({
  RoleForm: ({
    onSubmit,
    onCancel,
  }: {
    onSubmit: (values: { name: string }) => void;
    onCancel: () => void;
  }) => (
    <>
      <button type="button" onClick={() => onSubmit({ name: 'Lead' })}>
        Submit form
      </button>
      <button type="button" onClick={onCancel}>
        Cancel form
      </button>
    </>
  ),
}));

describe('NewRoleForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the role and navigates back to the list', async () => {
    mockCreateRole.mockResolvedValue({ id: 'rol_new' });
    render(<NewRoleForm orgId="org_1" />);

    fireEvent.click(screen.getByText('Submit form'));
    await waitFor(() => expect(mockCreateRole).toHaveBeenCalledWith({ name: 'Lead' }));
    expect(mockPush).toHaveBeenCalledWith('/org_1/settings/roles');
  });

  it('surfaces server errors without navigating', async () => {
    mockCreateRole.mockRejectedValue(new Error('Role "Lead" already exists'));
    render(<NewRoleForm orgId="org_1" />);

    fireEvent.click(screen.getByText('Submit form'));
    expect(await screen.findByText('Role "Lead" already exists')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('cancels back to the list', () => {
    render(<NewRoleForm orgId="org_1" />);

    fireEvent.click(screen.getByText('Cancel form'));
    expect(mockPush).toHaveBeenCalledWith('/org_1/settings/roles');
    expect(mockCreateRole).not.toHaveBeenCalled();
  });
});
