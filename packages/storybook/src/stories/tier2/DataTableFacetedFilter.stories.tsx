import type { Meta, StoryObj } from '@storybook/react';
import { DataTableFacetedFilter } from '../../../../../apps/app/src/components/data-table/data-table-faceted-filter';

const meta = {
  title: 'Tier 2 — DataTableFacetedFilter',
  component: DataTableFacetedFilter,
} satisfies Meta<typeof DataTableFacetedFilter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    options: [{ label: 'Example title 1', value: 'Example 1' }, { label: 'Example title 2', value: 'Example 2' }, { label: 'Example title 3', value: 'Example 3' }],
    title: 'Example title',
    multiple: false,
  },
};
