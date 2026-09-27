import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

mockNextIntl();

// Mock usePermissions
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

import { TaskItemsHeader } from './TaskItemsHeader';

const defaultProps = {
  title: 'Tasks',
  description: 'Manage your tasks',
  statsLoading: false,
  stats: {
    total: 5,
    byStatus: {
      todo: 2,
      in_progress: 1,
      in_review: 1,
      done: 1,
      canceled: 0,
    },
  },
  isCreateOpen: false,
  onToggleCreate: vi.fn(),
};

describe('TaskItemsHeader permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the create button when user has task:create permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);

    render(<TaskItemsHeader {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'header.createTask' })).toBeInTheDocument();
  });

  it('hides the create button when user lacks task:create permission', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);

    render(<TaskItemsHeader {...defaultProps} />);

    expect(screen.queryByRole('button', { name: 'header.createTask' })).not.toBeInTheDocument();
  });

  it('hides the create button when user has no permissions', () => {
    setMockPermissions({});

    render(<TaskItemsHeader {...defaultProps} />);

    expect(screen.queryByRole('button', { name: 'header.createTask' })).not.toBeInTheDocument();
  });

  it('renders title and description regardless of permissions', () => {
    setMockPermissions({});

    render(<TaskItemsHeader {...defaultProps} />);

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Manage your tasks')).toBeInTheDocument();
  });

  it('renders stats badges regardless of permissions', () => {
    setMockPermissions({});

    render(<TaskItemsHeader {...defaultProps} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2 todo')).toBeInTheDocument();
    expect(screen.getByText('1 inProgress')).toBeInTheDocument();
  });

  it('shows close button variant when isCreateOpen is true and user has permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);

    render(<TaskItemsHeader {...defaultProps} isCreateOpen={true} />);

    expect(screen.getByRole('button', { name: 'header.closeCreateTask' })).toBeInTheDocument();
  });
});
