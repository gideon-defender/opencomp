import { HoverCard } from '@gideon-defender/ui/hover-card';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — HoverCard',
  component: HoverCard,
} satisfies Meta<typeof HoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
  },
};
