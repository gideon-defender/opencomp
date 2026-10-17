import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesTable, type CustomRole } from './RolesTable';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ orgId: 'org_1' }),
}));

const mockHasPermission = vi.fn<(resource: string, action: string) => boolean>(() => false);
const mockDeleteRole = vi.fn();
const mockRefreshRoles = vi.fn();
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}));
vi.mock('../hooks/useRoles', () => ({
  // Mutation-only component: must not subscribe to the roles list. If it
  // calls useRoles again, this throws and the test fails.
  useRoles: () => {
    throw new Error('RolesTable must use useRoleMutations, not useRoles');
  },
  useRoleMutations: () => ({ deleteRole: mockDeleteRole, refreshRoles: mockRefreshRoles }),
}));

const mockRoles: CustomRole[] = [
  {
    id: 'role-1',
    name: 'compliance-lead',
    permissions: {
      control: ['read', 'update'],
      policy: ['read', 'update'],
    },
    obligations: {},
    isBuiltIn: false,
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    _count: { members: 3 },
  },
  {
    id: 'role-2',
    name: 'risk-manager',
    permissions: {
      risk: ['create', 'read', 'update', 'delete'],
    },
    obligations: { compliance: true },
    isBuiltIn: false,
    createdAt: '2024-02-01T10:00:00.000Z',
    updatedAt: '2024-02-01T10:00:00.000Z',
    _count: { members: 0 },
  },
];

describe('RolesTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(false);
  });

  describe('Rendering', () => {
    it('renders the table with column headers', () => {
      render(<RolesTable roles={mockRoles} />);

      expect(screen.getByText('NAME')).toBeInTheDocument();
      expect(screen.getByText('PERMISSIONS')).toBeInTheDocument();
      expect(screen.getByText('MEMBERS')).toBeInTheDocument();
      expect(screen.getByText('CREATED')).toBeInTheDocument();
      expect(screen.getByText(/Define what each role can do/)).toBeInTheDocument();
    });

    it('renders all roles in the table', () => {
      render(<RolesTable roles={mockRoles} />);

      expect(screen.getByText('compliance-lead')).toBeInTheDocument();
      expect(screen.getByText('risk-manager')).toBeInTheDocument();
    });

    it('read-only user sees no New/Edit/Delete', () => {
      render(<RolesTable roles={mockRoles} />);

      expect(screen.queryByRole('button', { name: /New role/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /View\/Edit/i })).not.toBeInTheDocument();
    });

    it('admin sees New/Edit/Delete, delete disabled while holders exist', () => {
      mockHasPermission.mockImplementation(
        (resource: string, action: string) =>
          resource === 'ac' && ['create', 'update', 'delete'].includes(action),
      );
      render(<RolesTable roles={mockRoles} />);

      expect(screen.getByRole('button', { name: /New role/i })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /View\/Edit/i })).toHaveLength(2);
      const deletes = screen.getAllByRole('button', { name: /Delete/i });
      expect(deletes).toHaveLength(2);
      // 3 holders → disabled with Gideon guidance; 0 holders → enabled.
      expect(deletes[0]).toBeDisabled();
      expect(deletes[0]).toHaveAttribute('title', expect.stringContaining('Gideon'));
      expect(deletes[1]).toBeEnabled();
    });
  });

  describe('Empty State', () => {
    it('shows empty message when no roles exist', () => {
      render(<RolesTable roles={[]} />);

      expect(screen.getByText('No custom roles yet')).toBeInTheDocument();
    });
  });

  describe('Search Filtering', () => {
    it('filters roles by name case-insensitively', async () => {
      render(<RolesTable roles={mockRoles} />);

      const searchInput = screen.getByPlaceholderText('Search roles...');
      fireEvent.change(searchInput, { target: { value: 'RISK' } });

      expect(screen.getByText('risk-manager')).toBeInTheDocument();
      expect(screen.queryByText('compliance-lead')).not.toBeInTheDocument();
    });
  });

  describe('Delete flow', () => {
    it('confirms and deletes a holder-free role, alerts on failure', async () => {
      mockHasPermission.mockImplementation(
        (resource: string, action: string) =>
          resource === 'ac' && ['create', 'update', 'delete'].includes(action),
      );
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      mockDeleteRole.mockResolvedValue({ id: 'role-2', deleted: true });
      render(<RolesTable roles={mockRoles} />);

      const deletes = screen.getAllByRole('button', { name: /Delete/i });
      fireEvent.click(deletes[1]);
      expect(confirmSpy).toHaveBeenCalled();
      await vi.waitFor(() => expect(mockDeleteRole).toHaveBeenCalledWith('role-2'));

      mockDeleteRole.mockRejectedValueOnce(new Error('boom'));
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      // The first delete is still settling (button disabled) — wait for it.
      await vi.waitFor(() =>
        expect(screen.getAllByRole('button', { name: /Delete/i })[1]).toBeEnabled(),
      );
      fireEvent.click(screen.getAllByRole('button', { name: /Delete/i })[1]);
      await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledWith('boom'));
      // A failed delete revalidates so the stale 0-member row corrects itself.
      await vi.waitFor(() => expect(mockRefreshRoles).toHaveBeenCalled());
      alertSpy.mockRestore();
      confirmSpy.mockRestore();
    });

    it('does nothing when holders exist', async () => {
      mockHasPermission.mockImplementation(() => true);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<RolesTable roles={mockRoles} />);

      const deletes = screen.getAllByRole('button', { name: /Delete/i });
      fireEvent.click(deletes[0]);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(mockDeleteRole).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });
  });
});
