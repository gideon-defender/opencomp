import type { Meta, StoryObj } from '@storybook/react';
import { Sortable } from '../../../../../apps/app/src/components/data-table/sortable';

const meta = {
  title: 'Tier 2 — Sortable',
  component: Sortable,
} satisfies Meta<typeof Sortable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: [],
    children: 'Example content',
    orientation: 'mixed',
    flatCursor: false,
  },
};
