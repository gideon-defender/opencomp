import type { Meta, StoryObj } from '@storybook/react';
import { Drawer } from '@gideon-defender/ui/drawer';

const meta = {
  title: 'Tier 1 — Drawer',
  component: Drawer,
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    snapPoints: ['Example 1', 'Example 2', 'Example 3'],
    fadeFromIndex: 42,
    children: 'Example content',
    open: false,
  },
};
