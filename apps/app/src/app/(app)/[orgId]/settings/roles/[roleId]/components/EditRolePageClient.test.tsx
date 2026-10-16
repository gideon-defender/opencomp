'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomRole } from '../../components/RolesTable';
import { EditRolePageClient } from './EditRolePageClient';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockHasPermission = vi.fn<(resource: string, action: string) => boolean>(() => true);
const mockUpdateRole = vi.fn();
const mockDeleteRole = vi.fn();
const mockFetchRole = vi.fn();
const mockRefreshRoles = vi.fn();
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock('../../hooks/useRoles', () => ({
  // Mutation-only component: must not subscribe to the roles list. If it
  // calls useRoles again, this throws and the test fails.
  useRoles: () => {
    throw new Error('EditRolePageClient must use useRoleMutations, not useRoles');
  },
  useRoleMutations: () => ({
    updateRole: mockUpdateRole,
    deleteRole: mockDeleteRole,
    fetchRole: mockFetchRole,
    refreshRoles: mockRefreshRoles,
  }),
}));

vi.mock('../../components/RoleForm', () => ({
  RoleForm: ({ onSubmit }: { onSubmit: (values: { name: string }) => void }) => (
    <button type="button" onClick={() => onSubmit({ name: 'Renamed' })}>
      Submit form
    </button>
  ),
}));

const baseRole: CustomRole = {
  id: 'rol_1',
  name: 'Lead',
  permissions: { control: ['read'] },
  obligations: {},
  isBuiltIn: false,
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
  _count: { members: 2 },
};

describe('EditRolePageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  it('requires typing the current name before renaming with holders', async () => {
    mockUpdateRole.mockResolvedValue({ id: 'rol_1' });
    render(<EditRolePageClient orgId="org_1" initialData={baseRole} />);

    fireEvent.click(screen.getByText('Submit form'));
    // The amber holders box also mentions typing the name — match the exact
    // server error text so the query is unambiguous.
    expect(
      await screen.findByText(/type the current name "Lead" in the warning box above/i),
    ).toBeInTheDocument();
    expect(mockUpdateRole).not.toHaveBeenCalled();
  });

  it('passes confirmRename after typing the current name', async () => {
    mockUpdateRole.mockResolvedValue({ id: 'rol_1' });
    render(<EditRolePageClient orgId="org_1" initialData={baseRole} />);

    fireEvent.change(screen.getByPlaceholderText('Lead'), {
      target: { value: 'Lead' },
    });
    fireEvent.click(screen.getByText('Submit form'));
    await waitFor(() =>
      expect(mockUpdateRole).toHaveBeenCalledWith(
        'rol_1',
        expect.objectContaining({ confirmRename: true }),
      ),
    );
    expect(mockPush).toHaveBeenCalledWith('/org_1/settings/roles');
  });

  it('blocks delete while holders exist', () => {
    render(<EditRolePageClient orgId="org_1" initialData={baseRole} />);
    expect(screen.queryByRole('button', { name: /Delete Lead/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Remove assignments in Gideon first/i)).toBeInTheDocument();
  });

  it('recovers when holders appear after page load (stale zero count)', async () => {
    const staleRole: CustomRole = { ...baseRole, _count: { members: 0 } };
    mockUpdateRole
      .mockRejectedValueOnce(
        new Error(
          'Renaming "Lead" affects 1 members — retry with confirmRename: true after removing or migrating Gideon assignments',
        ),
      )
      .mockResolvedValue({ id: 'rol_1' });
    mockFetchRole.mockResolvedValueOnce({ ...staleRole, _count: { members: 1 } });
    render(<EditRolePageClient orgId="org_1" initialData={staleRole} />);

    // No confirm box yet — the page loaded with zero holders.
    expect(screen.queryByPlaceholderText('Lead')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Submit form'));

    // The server demanded confirmRename: the box appears and names the flag.
    const confirmInput = await screen.findByPlaceholderText('Lead');
    expect(mockUpdateRole).toHaveBeenCalledWith(
      'rol_1',
      expect.not.objectContaining({ confirmRename: true }),
    );
    // The box shows the re-read count, not the stale zero.
    expect(screen.getByText(/1 members currently hold 'Lead'/i)).toBeInTheDocument();
    fireEvent.change(confirmInput, { target: { value: 'Lead' } });
    fireEvent.click(screen.getByText('Submit form'));
    await waitFor(() =>
      expect(mockUpdateRole).toHaveBeenCalledWith(
        'rol_1',
        expect.objectContaining({ confirmRename: true }),
      ),
    );
    expect(mockPush).toHaveBeenCalledWith('/org_1/settings/roles');
  });

  it('shows the fresh holder count when the server demands rename confirmation', async () => {
    const staleRole: CustomRole = { ...baseRole, _count: { members: 0 } };
    mockUpdateRole.mockRejectedValueOnce(
      new Error(
        'Renaming "Lead" affects 3 members — retry with confirmRename: true after removing or migrating Gideon assignments',
      ),
    );
    mockFetchRole.mockResolvedValueOnce({ ...staleRole, _count: { members: 3 } });
    render(<EditRolePageClient orgId="org_1" initialData={staleRole} />);

    fireEvent.click(screen.getByText('Submit form'));

    // The box shows the re-read count, never the stale zero.
    expect(await screen.findByText(/3 members currently hold 'Lead'/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 members currently hold/i)).not.toBeInTheDocument();
    expect(mockRefreshRoles).toHaveBeenCalled();
  });

  it('refreshes the holder count when delete is blocked by fresh assignments', async () => {
    const staleRole: CustomRole = { ...baseRole, _count: { members: 0 } };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockDeleteRole.mockRejectedValueOnce(
      new Error(
        'Cannot delete role "Lead": 2 members currently hold it. Remove assignments in Gideon first (they clear at next login/reconciliation), then retry.',
      ),
    );
    mockFetchRole.mockResolvedValueOnce({ ...staleRole, _count: { members: 2 } });
    render(<EditRolePageClient orgId="org_1" initialData={staleRole} />);

    fireEvent.click(screen.getByRole('button', { name: /Delete Lead/i }));

    await waitFor(() => expect(mockFetchRole).toHaveBeenCalledWith('rol_1'));
    // The fresh count replaces the stale deletable row — no retry loop.
    expect(screen.getByText(/2 members currently hold this role/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Lead/i })).not.toBeInTheDocument();
    expect(mockRefreshRoles).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('confirms before deleting a holder-free role', async () => {
    const staleRole: CustomRole = { ...baseRole, _count: { members: 0 } };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<EditRolePageClient orgId="org_1" initialData={staleRole} />);

    fireEvent.click(screen.getByRole('button', { name: /Delete Lead/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDeleteRole).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    mockDeleteRole.mockResolvedValue({ id: 'rol_1', deleted: true });
    fireEvent.click(screen.getByRole('button', { name: /Delete Lead/i }));
    await waitFor(() => expect(mockDeleteRole).toHaveBeenCalledWith('rol_1'));
    expect(mockPush).toHaveBeenCalledWith('/org_1/settings/roles');
    confirmSpy.mockRestore();
  });
});
