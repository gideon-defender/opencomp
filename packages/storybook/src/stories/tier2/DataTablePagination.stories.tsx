import type { Meta, StoryObj } from '@storybook/react';
import { DataTablePagination } from '../../../../../apps/app/src/components/tables/policies/data-table-pagination';

const meta = {
  title: 'Tier 2 — DataTablePagination',
  component: DataTablePagination,
} satisfies Meta<typeof DataTablePagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    pageCount: 42,
    currentPage: 42,
  },
};
