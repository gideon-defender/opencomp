import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import type { ExtendedColumnFilter } from '@/types/data-table';
import type { Column } from '@tanstack/react-table';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTableRangeFilter } from './data-table-range-filter';

const { useLocale: mockUseLocale } = mockNextIntl();

interface TestRow {
  amount: number;
}

function createColumn(): Column<TestRow> {
  return {
    id: 'amount',
    columnDef: {
      id: 'amount',
      meta: { label: 'Amount', variant: 'range' },
    },
    getFacetedMinMaxValues: () => [0, 100],
  } as unknown as Column<TestRow>;
}

function createFilter(): ExtendedColumnFilter<TestRow> {
  return {
    id: 'amount',
    value: ['10', '20'],
    variant: 'range',
    operator: 'isBetween',
    filterId: 'filter-1',
  };
}

describe('DataTableRangeFilter i18n', () => {
  it('uses translated aria-labels for min and max inputs', () => {
    render(
      <DataTableRangeFilter
        filter={createFilter()}
        column={createColumn()}
        inputId="test-input"
        onFilterUpdate={vi.fn()}
      />,
    );

    // mockNextIntl resolves t(key) to the key itself.
    expect(screen.getByLabelText('rangeMin')).toBeInTheDocument();
    expect(screen.getByLabelText('rangeMax')).toBeInTheDocument();
  });

  it('falls back to the column id when no label is set', () => {
    const column = {
      ...createColumn(),
      columnDef: { id: 'amount', meta: { variant: 'range' } },
    } as unknown as Column<TestRow>;

    render(
      <DataTableRangeFilter
        filter={createFilter()}
        column={column}
        inputId="test-input"
        onFilterUpdate={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('rangeMin')).toHaveAttribute('id', 'test-input-min');
    expect(screen.getByLabelText('rangeMax')).toHaveAttribute('id', 'test-input-max');
  });

  it('keeps number input values ungrouped under the es locale', () => {
    vi.mocked(mockUseLocale).mockReturnValue('es');
    try {
      const column = {
        ...createColumn(),
        columnDef: {
          id: 'amount',
          meta: { label: 'Amount', variant: 'range', range: [1000, 9000] },
        },
      } as unknown as Column<TestRow>;

      render(
        <DataTableRangeFilter
          filter={{ ...createFilter(), value: ['1234', '5678'] }}
          column={column}
          inputId="test-input"
          onFilterUpdate={vi.fn()}
        />,
      );

      // Grouped digits are invalid for type="number" and would blank the
      // input, so values stay raw while the placeholder shows grouping.
      expect(screen.getByLabelText('rangeMin')).toHaveValue(1234);
      expect(screen.getByLabelText('rangeMax')).toHaveValue(5678);
      expect(screen.getByLabelText('rangeMin')).toHaveAttribute(
        'placeholder',
        (1000).toLocaleString('es'),
      );
    } finally {
      vi.mocked(mockUseLocale).mockReturnValue('en');
    }
  });
});
