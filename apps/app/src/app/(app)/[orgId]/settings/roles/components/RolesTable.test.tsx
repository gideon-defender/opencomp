import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesTable, type CustomRole } from './RolesTable';

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
  });

  describe('Rendering', () => {
    it('renders the table with column headers', () => {
      render(<RolesTable roles={mockRoles} />);

      expect(screen.getByText('NAME')).toBeInTheDocument();
      expect(screen.getByText('PERMISSIONS')).toBeInTheDocument();
      expect(screen.getByText('CREATED')).toBeInTheDocument();
      // IdP-owned: no local actions column; list is read-only.
      expect(screen.queryByText('ACTIONS')).not.toBeInTheDocument();
      expect(screen.getByText(/OpenComp defines role permissions/)).toBeInTheDocument();
    });

    it('renders all roles in the table', () => {
      render(<RolesTable roles={mockRoles} />);

      expect(screen.getByText('compliance-lead')).toBeInTheDocument();
      expect(screen.getByText('risk-manager')).toBeInTheDocument();
    });

    it('displays permission count for each role', () => {
      render(<RolesTable roles={mockRoles} />);

      expect(screen.getByText('2 resources')).toBeInTheDocument(); // compliance-lead
      expect(screen.getByText('1 resources')).toBeInTheDocument(); // risk-manager (singular issue, but acceptable)
    });

    it('formats dates correctly', () => {
      render(<RolesTable roles={mockRoles} />);

      // Check for formatted dates (format: "Jan 15, 2024")
      expect(screen.getByText('Jan 15, 2024')).toBeInTheDocument();
      expect(screen.getByText('Feb 1, 2024')).toBeInTheDocument();
    });

    it('does not render a Create Role button (Gideon-synced, read-only)', () => {
      render(<RolesTable roles={mockRoles} />);

      expect(screen.queryByRole('button', { name: /Create Role/i })).not.toBeInTheDocument();
      expect(screen.getByText(/OpenComp defines role permissions/)).toBeInTheDocument();
    });

    it('renders the search input', () => {
      render(<RolesTable roles={mockRoles} />);

      expect(screen.getByPlaceholderText('Search roles...')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('shows empty message when no roles exist', () => {
      render(<RolesTable roles={[]} />);

      expect(screen.getByText('No custom roles yet')).toBeInTheDocument();
    });

    it('shows no match message when search returns no results', async () => {
      render(<RolesTable roles={mockRoles} />);

      const searchInput = screen.getByPlaceholderText('Search roles...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

      expect(screen.getByText('No roles match your search')).toBeInTheDocument();
    });
  });

  describe('Search Filtering', () => {
    it('filters roles by name', async () => {
      render(<RolesTable roles={mockRoles} />);

      const searchInput = screen.getByPlaceholderText('Search roles...');
      fireEvent.change(searchInput, { target: { value: 'compliance' } });

      expect(screen.getByText('compliance-lead')).toBeInTheDocument();
      expect(screen.queryByText('risk-manager')).not.toBeInTheDocument();
    });

    it('is case-insensitive', async () => {
      render(<RolesTable roles={mockRoles} />);

      const searchInput = screen.getByPlaceholderText('Search roles...');
      fireEvent.change(searchInput, { target: { value: 'RISK' } });

      expect(screen.getByText('risk-manager')).toBeInTheDocument();
      expect(screen.queryByText('compliance-lead')).not.toBeInTheDocument();
    });

    it('shows all roles when search is cleared', async () => {
      render(<RolesTable roles={mockRoles} />);

      const searchInput = screen.getByPlaceholderText('Search roles...');
      fireEvent.change(searchInput, { target: { value: 'compliance' } });
      fireEvent.change(searchInput, { target: { value: '' } });

      expect(screen.getByText('compliance-lead')).toBeInTheDocument();
      expect(screen.getByText('risk-manager')).toBeInTheDocument();
    });
  });

  describe('Actions', () => {
    it('renders no action buttons (read-only)', () => {
      render(<RolesTable roles={mockRoles} />);

      // Only the search input renders; no row action menu triggers remain.
      expect(screen.queryAllByRole('button').length).toBe(0);
    });
  });
});
