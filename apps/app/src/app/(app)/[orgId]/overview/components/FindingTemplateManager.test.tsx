import type { FindingTemplate } from '@/hooks/use-findings-api';
import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

mockNextIntl();

const mockUseFindingTemplates = vi.fn();
const mockCreateTemplate = vi.fn();
const mockUpdateTemplate = vi.fn();
const mockDeleteTemplate = vi.fn();

vi.mock('@/hooks/use-findings-api', () => ({
  useFindingTemplates: (...args: unknown[]) => mockUseFindingTemplates(...args),
  useFindingTemplateActions: () => ({
    createTemplate: mockCreateTemplate,
    updateTemplate: mockUpdateTemplate,
    deleteTemplate: mockDeleteTemplate,
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Radix Sheet/Select/AlertDialog render through portals and focus guards
// that jsdom cannot drive — stub them to plain elements like the other
// sheet tests do.
vi.mock('@gideon-defender/ui/sheet', () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@gideon-defender/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select
      data-testid="category-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock('@gideon-defender/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="delete-dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

import { FindingTemplateManager } from './FindingTemplateManager';

function makeTemplate(overrides: Partial<FindingTemplate> = {}): FindingTemplate {
  return {
    id: 'fnd_t_1',
    category: 'evidence_issue',
    title: 'Missing organization context',
    content: 'Please provide a screenshot showing the context.',
    order: 1,
    organizationId: 'org_1',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('FindingTemplateManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFindingTemplates.mockReturnValue({ data: { data: [] }, isLoading: false });
  });

  it('lists org templates and marks global templates read-only', () => {
    mockUseFindingTemplates.mockReturnValue({
      data: {
        data: [
          makeTemplate({ id: 'fnd_t_org', title: 'Org template' }),
          makeTemplate({
            id: 'fnd_t_global',
            title: 'Global template',
            organizationId: null,
          }),
        ],
      },
      isLoading: false,
    });

    render(<FindingTemplateManager open onOpenChange={vi.fn()} />);

    expect(screen.getByText('Org template')).toBeInTheDocument();
    expect(screen.getByText('Global template')).toBeInTheDocument();
    expect(screen.getAllByText('findings.globalTemplateBadge').length).toBeGreaterThan(0);
    // Only the org row has row actions.
    expect(screen.getByLabelText('findings.editTemplate')).toBeInTheDocument();
    expect(screen.getByLabelText('findings.deleteTemplate')).toBeInTheDocument();
  });

  it('shows an empty state when there are no templates at all', () => {
    render(<FindingTemplateManager open onOpenChange={vi.fn()} />);

    expect(screen.getByText('findings.noOrgTemplates')).toBeInTheDocument();
  });

  it('shows a filtered-empty state when search matches nothing', async () => {
    const user = userEvent.setup();
    mockUseFindingTemplates.mockReturnValue({
      data: { data: [makeTemplate()] },
      isLoading: false,
    });
    render(<FindingTemplateManager open onOpenChange={vi.fn()} />);

    await user.type(
      screen.getByPlaceholderText('findings.templateSearchPlaceholder'),
      'zzz-no-match',
    );

    expect(screen.getByText('findings.noTemplatesMatchFilter')).toBeInTheDocument();
  });

  it('creates a per-org template from the form', async () => {
    const user = userEvent.setup();
    render(<FindingTemplateManager open onOpenChange={vi.fn()} />);

    await user.click(screen.getByText('findings.newTemplate'));

    await user.type(screen.getByPlaceholderText('findings.templateTitlePlaceholder'), 'New title');
    await user.type(
      screen.getByPlaceholderText('findings.templateContentPlaceholder'),
      'New content',
    );
    await user.selectOptions(screen.getByTestId('category-select'), 'evidence_issue');
    await user.click(screen.getByText('findings.createTemplate'));

    await waitFor(() => {
      expect(mockCreateTemplate).toHaveBeenCalledWith({
        category: 'evidence_issue',
        title: 'New title',
        content: 'New content',
        order: 0,
      });
    });
  });

  it('edits an org template and saves the changes', async () => {
    const user = userEvent.setup();
    mockUseFindingTemplates.mockReturnValue({
      data: { data: [makeTemplate()] },
      isLoading: false,
    });
    render(<FindingTemplateManager open onOpenChange={vi.fn()} />);

    await user.click(screen.getByLabelText('findings.editTemplate'));

    const titleInput = screen.getByPlaceholderText('findings.templateTitlePlaceholder');
    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed title');
    await user.click(screen.getByText('findings.saveTemplate'));

    await waitFor(() => {
      expect(mockUpdateTemplate).toHaveBeenCalledWith(
        'fnd_t_1',
        expect.objectContaining({ title: 'Renamed title' }),
      );
    });
  });

  it('confirms deletion through the dialog before deleting', async () => {
    const user = userEvent.setup();
    mockUseFindingTemplates.mockReturnValue({
      data: { data: [makeTemplate()] },
      isLoading: false,
    });
    render(<FindingTemplateManager open onOpenChange={vi.fn()} />);

    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('findings.deleteTemplate'));

    const dialog = screen.getByTestId('delete-dialog');
    expect(within(dialog).getByText('findings.deleteTemplateTitle')).toBeInTheDocument();
    expect(mockDeleteTemplate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'findings.deleteTemplate' }));

    await waitFor(() => {
      expect(mockDeleteTemplate).toHaveBeenCalledWith('fnd_t_1');
    });
  });

  it('paginates the table past ten templates', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 11 }, (_, i) =>
      makeTemplate({ id: `fnd_t_${i}`, title: `Template ${i}` }),
    );
    mockUseFindingTemplates.mockReturnValue({
      data: { data: rows },
      isLoading: false,
    });
    render(<FindingTemplateManager open onOpenChange={vi.fn()} />);

    expect(screen.getByText('Template 0')).toBeInTheDocument();
    expect(screen.queryByText('Template 10')).not.toBeInTheDocument();

    await user.click(screen.getByText('findings.templateNext'));

    expect(screen.getByText('Template 10')).toBeInTheDocument();
    expect(screen.queryByText('Template 0')).not.toBeInTheDocument();

    await user.click(screen.getByText('findings.templatePrevious'));

    expect(screen.getByText('Template 0')).toBeInTheDocument();
    expect(screen.queryByText('Template 10')).not.toBeInTheDocument();
  });
});
