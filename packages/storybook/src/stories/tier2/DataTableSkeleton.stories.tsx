import type { Meta, StoryObj } from '@storybook/react';
import { DataTableSkeleton } from '../../../../../apps/app/src/components/data-table/data-table-skeleton';

const meta = {
  title: 'Tier 2 — DataTableSkeleton',
  component: DataTableSkeleton,
} satisfies Meta<typeof DataTableSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    columnCount: 42,
    rowCount: 42,
    filterCount: 42,
    cellWidths: ['Example 1', 'Example 2', 'Example 3'],
    withViewOptions: false,
    withPagination: false,
    shrinkZero: false,
    children: 'Example content',
  },
};
