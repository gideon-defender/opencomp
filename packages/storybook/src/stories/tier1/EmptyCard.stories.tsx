import type { Meta, StoryObj } from '@storybook/react';
import { EmptyCard } from '@gideon-defender/ui/empty-card';

const meta = {
  title: 'Tier 1 — EmptyCard',
  component: EmptyCard,
} satisfies Meta<typeof EmptyCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    description: 'Example description',
    children: 'Example content',
  },
};
