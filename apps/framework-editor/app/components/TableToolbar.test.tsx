import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../test-utils/render-with-intl';
import { TableToolbar } from './TableToolbar';

vi.mock('@gideon-defender/ui', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

const baseProps = {
  searchTerm: '',
  onSearchTermChange: vi.fn(),
  sortColumnKey: null as string | null,
  onSortColumnKeyChange: vi.fn(),
  sortDirection: 'asc' as const,
  onSortDirectionChange: vi.fn(),
  sortableColumnOptions: [{ value: 'name', label: 'Name' }],
};

describe('TableToolbar i18n', () => {
  it('renders English search and sort strings by default', () => {
    renderWithIntl(<TableToolbar {...baseProps} />);
    expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
    expect(screen.getByText('Sort by...')).toBeTruthy();
    expect(screen.getByText('None')).toBeTruthy();
    expect(screen.getByTitle('Sort direction: Ascending')).toBeTruthy();
  });

  it('renders Spanish search and sort strings with the es locale', () => {
    renderWithIntl(<TableToolbar {...baseProps} />, 'es');
    expect(screen.getByPlaceholderText('Buscar...')).toBeTruthy();
    expect(screen.getByText('Ordenar por...')).toBeTruthy();
    expect(screen.getByText('Ninguno')).toBeTruthy();
    expect(screen.getByTitle('Dirección de orden: Ascendente')).toBeTruthy();
  });

  it('translates commit/discard actions when dirty', () => {
    const { unmount } = renderWithIntl(
      <TableToolbar
        {...baseProps}
        showCommitCancel
        isDirty
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        commitButtonDetailText="3 changes"
      />,
      'es',
    );
    expect(screen.getByText('Confirmar 3 changes')).toBeTruthy();
    expect(screen.getByText('Descartar cambios')).toBeTruthy();
    unmount();
  });

  it('shows the translated empty-state commit label when clean', () => {
    renderWithIntl(<TableToolbar {...baseProps} showCommitCancel onCommit={vi.fn()} />);
    expect(screen.getByText('No Changes')).toBeTruthy();
  });

  it('still forwards search input changes', () => {
    const onSearchTermChange = vi.fn();
    renderWithIntl(<TableToolbar {...baseProps} onSearchTermChange={onSearchTermChange} />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'iso' } });
    expect(onSearchTermChange).toHaveBeenCalledWith('iso');
  });
});
