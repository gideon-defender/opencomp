import type { Meta, StoryObj } from '@storybook/react';
import { Tooltip } from '@gideon-defender/ui/tooltip';

const meta = {
  title: 'Tier 1 — Tooltip',
  component: Tooltip,
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
  },
};
