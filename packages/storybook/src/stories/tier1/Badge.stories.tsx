import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '@gideon-defender/ui/badge';

const meta = {
  title: 'Tier 1 — Badge',
  component: Badge,
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    variant: 'default',
  },
};
