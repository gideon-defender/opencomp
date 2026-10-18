import type { Meta, StoryObj } from '@storybook/react';
import { Tabs } from '@gideon-defender/ui/tabs';

const meta = {
  title: 'Tier 1 — Tabs',
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
