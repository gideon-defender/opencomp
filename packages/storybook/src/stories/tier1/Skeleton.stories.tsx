import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton } from '@gideon-defender/ui/skeleton';

const meta = {
  title: 'Tier 1 — Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
