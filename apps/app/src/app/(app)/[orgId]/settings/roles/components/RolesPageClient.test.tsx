import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesPageClient } from './RolesPageClient';
import type { CustomRole } from './RolesTable';

vi.mock('../hooks/useRoles', () => ({
  useRoles: () => mockUseRoles(),
}));

interface MockRolesState {
  roles: CustomRole[];
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => Promise<unknown>;
}

const mockUseRoles = vi.fn<() => MockRolesState>(() => ({
  roles: [],
  isLoading: false,
  error: undefined,
  mutate: () => Promise.resolve(),
}));

vi.mock('../loading', () => ({
  default: () => <div>Loading roles...</div>,
}));

vi.mock('./RolesTable', () => ({
  RolesTable: () => <div>Roles table</div>,
}));

vi.mock('./SystemRoles', () => ({
  SystemRolesTable: () => <div>System roles</div>,
}));

describe('RolesPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRoles.mockReturnValue({
      roles: [],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
  });

  it('shows the tables when loading succeeds', () => {
    render(<RolesPageClient initialData={[]} />);

    expect(screen.getByText('Roles table')).toBeInTheDocument();
    expect(screen.queryByText('Could not load roles.')).not.toBeInTheDocument();
  });

  it('shows an error with retry instead of an empty list on fetch failure', () => {
    const mutate = vi.fn();
    mockUseRoles.mockReturnValue({
      roles: [],
      isLoading: false,
      error: new Error('Request failed'),
      mutate,
    });
    render(<RolesPageClient initialData={[]} />);

    expect(screen.getByText('Could not load roles.')).toBeInTheDocument();
    expect(screen.getByText('System roles')).toBeInTheDocument();
    expect(screen.queryByText('Roles table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('preserves built-in role access when an auditor cannot read custom roles', () => {
    mockUseRoles.mockReturnValue({
      roles: [],
      isLoading: false,
      error: new Error('Access denied'),
      mutate: vi.fn(),
    });
    render(<RolesPageClient initialData={[]} />);

    expect(screen.getByText('System roles')).toBeInTheDocument();
    expect(screen.getByText(/Access denied/)).toBeInTheDocument();
    expect(screen.queryByText('Roles table')).not.toBeInTheDocument();
  });
});
