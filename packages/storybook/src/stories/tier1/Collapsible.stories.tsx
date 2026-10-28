import { Collapsible } from '@gideon-defender/ui/collapsible';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — Collapsible',
  component: Collapsible,
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: false,
    children: 'Example content',
  },
};
