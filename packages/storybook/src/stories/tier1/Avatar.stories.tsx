import type { Meta, StoryObj } from '@storybook/react';
import { Avatar } from '@gideon-defender/ui/avatar';

const meta = {
  title: 'Tier 1 — Avatar',
  component: Avatar,
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
