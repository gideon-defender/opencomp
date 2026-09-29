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

// Mock useOptimisticTaskItems + useAuditLogs
vi.mock('@/hooks/use-task-items', () => ({
  useOptimisticTaskItems: () => ({
    optimisticUpdate: vi.fn(),
    optimisticDelete: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-audit-logs', () => ({
  useAuditLogs: () => ({ logs: [], mutate: vi.fn() }),
}));

// Mock useAssignableMembers
vi.mock('@/hooks/use-organization-members', () => ({
  useAssignableMembers: () => ({
    members: [],
  }),
}));

// Mock filterMembersByOwnerOrAdmin
vi.mock('@/utils/filter-members-by-role', () => ({
  filterMembersByOwnerOrAdmin: () => [],
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/risks/risk_1',
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock @db
vi.mock('@db', () => ({
  CommentEntityType: { task: 'task' },
}));

vi.mock('@gideon-defender/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="delete-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/RecentAuditLogs', () => ({
  RecentAuditLogs: () => <div data-testid="activity-timeline" />,
}));

vi.mock('../comments/Comments', () => ({
  Comments: () => <div data-testid="comments" />,
}));

vi.mock('@/components/SelectAssignee', () => ({
  SelectAssignee: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="select-assignee" data-disabled={disabled ? 'true' : 'false'} />
  ),
}));

vi.mock('@/components/status-indicator', () => ({
  StatusIndicator: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('./task-item-utils', () => ({
  STATUS_OPTIONS: [
    { value: 'todo', label: 'Todo' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'in_review', label: 'In Review' },
    { value: 'done', label: 'Done' },
    { value: 'canceled', label: 'Canceled' },
  ],
  PRIORITY_OPTIONS: [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ],
}));

vi.mock('lucide-react', () => ({
  Loader2: () => <span data-testid="loader-icon" />,
}));

vi.mock('@trycompai/design-system', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Grid: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  Label: ({ children }: any) => <label>{children}</label>,
  Select: ({ children, disabled, value }: any) => (
    <div data-testid="select" data-disabled={disabled ? 'true' : 'false'} data-value={value}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  Stack: ({ children }: any) => <div>{children}</div>,
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  Text: ({ children, onClick }: any) => <p onClick={onClick}>{children}</p>,
}));

import { TaskItemFocusView } from './TaskItemFocusView';

const mockTaskItem: any = {
  id: 'tski_abc123def456',
  title: 'Test Task',
  description: 'Test description',
  status: 'todo',
  priority: 'medium',
  assignee: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const defaultProps = {
  taskItem: mockTaskItem,
  entityId: 'entity_1',
  entityType: 'vendor' as const,
  onBack: vi.fn(),
};

describe('TaskItemFocusView permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables status/priority selectors and assignee when user has task:update permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);

    render(<TaskItemFocusView {...defaultProps} />);

    const selects = screen.getAllByTestId('select');
    for (const select of selects) {
      expect(select).toHaveAttribute('data-disabled', 'false');
    }
    expect(screen.getByTestId('select-assignee')).toHaveAttribute('data-disabled', 'false');
  });

  it('disables status/priority selectors and assignee when user lacks task:update permission', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);

    render(<TaskItemFocusView {...defaultProps} />);

    const selects = screen.getAllByTestId('select');
    for (const select of selects) {
      expect(select).toHaveAttribute('data-disabled', 'true');
    }
    expect(screen.getByTestId('select-assignee')).toHaveAttribute('data-disabled', 'true');
  });

  it('shows the Delete Task button when user has task:delete permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);

    render(<TaskItemFocusView {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Delete Task' })).toBeInTheDocument();
  });

  it('hides the Delete Task button when user lacks task:delete permission', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);

    render(<TaskItemFocusView {...defaultProps} />);

    expect(screen.queryByRole('button', { name: 'Delete Task' })).not.toBeInTheDocument();
  });

  it('hides the Delete Task button when user has no permissions', () => {
    setMockPermissions({});

    render(<TaskItemFocusView {...defaultProps} />);

    expect(screen.queryByRole('button', { name: 'Delete Task' })).not.toBeInTheDocument();
  });

  it('always renders activity timeline and comments regardless of permissions', () => {
    setMockPermissions({});

    render(<TaskItemFocusView {...defaultProps} />);

    expect(screen.getByTestId('activity-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('comments')).toBeInTheDocument();
  });
});
