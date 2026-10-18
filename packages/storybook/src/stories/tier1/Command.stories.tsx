import type { Meta, StoryObj } from '@storybook/react';
import { Command } from '@gideon-defender/ui/command';

const meta = {
  title: 'Tier 1 — Command',
  component: Command,
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
