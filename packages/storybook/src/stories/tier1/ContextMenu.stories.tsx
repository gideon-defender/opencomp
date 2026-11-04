import { ContextMenu } from '@gideon-defender/ui/context-menu';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — ContextMenu',
  component: ContextMenu,
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
