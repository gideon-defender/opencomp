import { CollapsibleCard } from '@gideon-defender/ui/collapsible-card';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — CollapsibleCard',
  component: CollapsibleCard,
} satisfies Meta<typeof CollapsibleCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: false,
    children: 'Example content',
  },
};
