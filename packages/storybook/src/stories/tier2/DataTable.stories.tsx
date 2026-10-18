import type { Meta, StoryObj } from '@storybook/react';
import { DataTable } from '../../../../../apps/app/src/components/tables/policies/data-table';

const meta = {
  title: 'Tier 2 — DataTable',
  component: DataTable,
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    columnHeaders: { name: 'Example name', status: 'Example', updatedAt: '2026-01-01T00:00:00.000Z' },
    data: [],
    pageCount: 42,
    currentPage: 42,
  },
};
