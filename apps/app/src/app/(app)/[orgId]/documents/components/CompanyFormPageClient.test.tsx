import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  NO_PERMISSIONS,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock usePermissions ─────────────────────────────────────

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

// ─── Mock SWR ────────────────────────────────────────────────

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
    mutate: vi.fn(),
  })),
  useSWRConfig: () => ({
    mutate: vi.fn(),
  }),
}));

// ─── Mock api client ─────────────────────────────────────────

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: null, error: null }),
    post: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

// ─── Mock design system ──────────────────────────────────────

vi.mock('@trycompai/design-system', () => ({
  AlertDialog: ({ children, open }: any) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null,
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  Badge: ({ children }: any) => <span>{children}</span>,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  DropdownMenuTrigger: ({ children }: any) => (
    <button data-testid="dropdown-trigger">{children}</button>
  ),
  Empty: ({ children }: any) => <div>{children}</div>,
  EmptyDescription: ({ children }: any) => <p>{children}</p>,
  EmptyHeader: ({ children }: any) => <div>{children}</div>,
  EmptyMedia: ({ children }: any) => <div>{children}</div>,
  EmptyTitle: ({ children }: any) => <h3>{children}</h3>,
  Field: ({ children }: any) => <div>{children}</div>,
  FieldLabel: ({ children }: any) => <label>{children}</label>,
  InputGroup: ({ children }: any) => <div>{children}</div>,
  InputGroupAddon: ({ children }: any) => <div>{children}</div>,
  InputGroupInput: (props: any) => <input {...props} />,
  PageHeader: ({ title, actions }: any) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {actions}
    </div>
  ),
  Stack: ({ children }: any) => <div>{children}</div>,
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  Text: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@trycompai/design-system/icons', () => ({
  Add: () => <span data-testid="add-icon" />,
  Catalog: () => <span data-testid="catalog-icon" />,
  Download: () => <span data-testid="download-icon" />,
  OverflowMenuVertical: () => <span data-testid="overflow-icon" />,
  Search: () => <span data-testid="search-icon" />,
  TrashCan: () => <span data-testid="trash-icon" />,
  Upload: () => <span data-testid="upload-icon" />,
}));

// ─── Mock submission-utils ───────────────────────────────────

vi.mock('./submission-utils', () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
  formatSubmissionDate: () => '01/01/2025',
}));

// ─── Mock sonner ─────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Mock next/link ──────────────────────────────────────────

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import { CompanyFormPageClient } from './CompanyFormPageClient';

mockNextIntl();

// ─── Tests ───────────────────────────────────────────────────

describe('CompanyFormPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Admin user (full permissions)', () => {
    beforeEach(() => {
      setMockPermissions(ADMIN_PERMISSIONS);
    });

    it('renders the New Submission button when user has evidence:create', () => {
      render(<CompanyFormPageClient organizationId="org-1" formType="access-request" />);

      expect(screen.getByText('companyForm.newSubmission')).toBeInTheDocument();
    });

    it('renders the Export CSV button when user has evidence:read', () => {
      render(<CompanyFormPageClient organizationId="org-1" formType="access-request" />);

      expect(screen.getByText('companyForm.exportCsv')).toBeInTheDocument();
    });

    it('checks evidence:create and evidence:read permissions', () => {
      render(<CompanyFormPageClient organizationId="org-1" formType="access-request" />);

      expect(mockHasPermission).toHaveBeenCalledWith('evidence', 'create');
      expect(mockHasPermission).toHaveBeenCalledWith('evidence', 'read');
    });
  });

  describe('Auditor user (read-only)', () => {
    beforeEach(() => {
      setMockPermissions(AUDITOR_PERMISSIONS);
    });

    it('hides New Submission button when user lacks evidence:create', () => {
      render(<CompanyFormPageClient organizationId="org-1" formType="access-request" />);

      const hasCreate = mockHasPermission('evidence', 'create');
      if (!hasCreate) {
        expect(screen.queryByText('companyForm.newSubmission')).not.toBeInTheDocument();
      }
    });

    it('shows Export CSV when auditor has evidence:read', () => {
      render(<CompanyFormPageClient organizationId="org-1" formType="access-request" />);

      const hasRead = mockHasPermission('evidence', 'read');
      if (hasRead) {
        expect(screen.getByText('companyForm.exportCsv')).toBeInTheDocument();
      }
    });
  });

  describe('No permissions', () => {
    beforeEach(() => {
      setMockPermissions(NO_PERMISSIONS);
    });

    it('hides New Submission button without evidence:create', () => {
      render(<CompanyFormPageClient organizationId="org-1" formType="access-request" />);

      expect(screen.queryByText('companyForm.newSubmission')).not.toBeInTheDocument();
    });

    it('hides Export CSV button without evidence:read', () => {
      render(<CompanyFormPageClient organizationId="org-1" formType="access-request" />);

      expect(screen.queryByText('companyForm.exportCsv')).not.toBeInTheDocument();
    });

    it('still renders the page header', () => {
      render(<CompanyFormPageClient organizationId="org-1" formType="access-request" />);

      expect(screen.getByTestId('page-header')).toBeInTheDocument();
    });
  });
});
