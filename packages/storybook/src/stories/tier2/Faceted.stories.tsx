import type { Meta, StoryObj } from '@storybook/react';
import { Faceted } from '../../../../../apps/app/src/components/data-table/faceted';

const meta = {
  title: 'Tier 2 — Faceted',
  component: Faceted,
} satisfies Meta<typeof Faceted>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
  },
};
