import type { Meta, StoryObj } from '@storybook/react';
import { DataTableHeader } from '../../../../../apps/app/src/components/tables/policies/data-table-header';
import { withTable } from '../../mocks/decorators';

const meta = {
  title: 'Tier 2 — DataTableHeader',
  component: DataTableHeader,
  decorators: [withTable],
} satisfies Meta<typeof DataTableHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    loading: false,
    isEmpty: false,
  },
};
