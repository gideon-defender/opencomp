import type { Meta, StoryObj } from '@storybook/react';
import { Popover } from '@gideon-defender/ui/popover';

const meta = {
  title: 'Tier 1 — Popover',
  component: Popover,
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
  },
};
