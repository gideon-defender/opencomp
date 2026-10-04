import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Add useParams to the global next/navigation mock
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useParams: vi.fn(() => ({ orgId: 'org_123', taskId: 'task_123' })),
  };
});

// Mock usePermissions
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

// Mock useTask hook
const mockTask = {
  id: 'task_123',
  title: 'Test Task',
  status: 'open',
  assigneeId: null,
  frequency: null,
  department: null,
  reviewDate: null,
  controls: [],
};

vi.mock('../hooks/use-task', () => ({
  useTask: () => ({
    task: mockTask,
    isLoading: false,
  }),
}));

// Mock useOrganizationMembers
vi.mock('@/hooks/use-organization-members', () => ({
  useOrganizationMembers: () => ({
    members: [
      {
        id: 'member_1',
        user: { id: 'user_1', name: 'Test User', email: 'test@example.com', image: null },
      },
    ],
  }),
}));

vi.mock('./constants', () => ({
  DEPARTMENT_COLORS: { none: '#888' },
  taskDepartments: ['none'],
  taskFrequencies: ['daily', 'weekly'],
  taskStatuses: ['open', 'done'],
}));

// Mock DepartmentSelect + SelectAssignee — surface the `disabled` prop as a
// data attribute so tests can assert on it.
vi.mock('@/components/DepartmentSelect', () => ({
  DepartmentSelect: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="department-select" data-disabled={disabled ? 'true' : 'false'} />
  ),
}));

vi.mock('@/components/SelectAssignee', () => ({
  SelectAssignee: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="select-assignee" data-disabled={disabled ? 'true' : 'false'} />
  ),
}));

// Mock design-system Select — surface the `disabled` prop on the trigger
// wrapper so tests can assert status/frequency selectors are gated.
vi.mock('@trycompai/design-system', () => ({
  Section: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  ),
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Grid: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
  Select: ({
    children,
    disabled,
    value,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    value?: string;
  }) => (
    <div data-testid="select" data-disabled={disabled ? 'true' : 'false'} data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Input: (props: Record<string, unknown>) => <input {...props} />,
  InputGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  InputGroupInput: (props: Record<string, unknown>) => <input {...props} />,
  InputGroupAddon: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('lucide-react', () => ({
  Calendar: () => <span data-testid="calendar-icon" />,
}));

vi.mock('../../components/NotRelevantJustificationDialog', () => ({
  NotRelevantJustificationDialog: () => null,
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

// Mock date-fns
vi.mock('date-fns', () => ({
  format: () => '1/1/2024',
}));

import { TaskPropertiesSidebar } from './TaskPropertiesSidebar';

const defaultProps = {
  handleUpdateTask: vi.fn(),
};

describe('TaskPropertiesSidebar permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables all PropertySelectors when user has task:update', () => {
    setMockPermissions(ADMIN_PERMISSIONS);

    render(<TaskPropertiesSidebar {...defaultProps} />);

    // Status + Frequency use the mocked design-system Select
    const selects = screen.getAllByTestId('select');
    expect(selects.length).toBe(2);
    for (const select of selects) {
      expect(select).toHaveAttribute('data-disabled', 'false');
    }

    // Department is gated by canUpdate
    expect(screen.getByTestId('department-select')).toHaveAttribute('data-disabled', 'false');
  });

  it('disables all selectors when user lacks task:update', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);

    render(<TaskPropertiesSidebar {...defaultProps} />);

    const selects = screen.getAllByTestId('select');
    for (const select of selects) {
      expect(select).toHaveAttribute('data-disabled', 'true');
    }

    expect(screen.getByTestId('department-select')).toHaveAttribute('data-disabled', 'true');
  });

  it('enables all selectors when user has task:update (assign is part of update)', () => {
    setMockPermissions({ task: ['read', 'update'] });

    render(<TaskPropertiesSidebar {...defaultProps} />);

    const selects = screen.getAllByTestId('select');
    for (const select of selects) {
      expect(select).toHaveAttribute('data-disabled', 'false');
    }

    expect(screen.getByTestId('select-assignee')).toHaveAttribute('data-disabled', 'false');
    expect(screen.getByTestId('department-select')).toHaveAttribute('data-disabled', 'false');
  });

  it('renders Properties heading regardless of permissions', () => {
    setMockPermissions({});

    render(<TaskPropertiesSidebar {...defaultProps} />);

    expect(screen.getByText('Evidence Settings')).toBeInTheDocument();
  });
});
