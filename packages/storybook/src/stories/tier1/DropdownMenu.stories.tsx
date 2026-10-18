import type { Meta, StoryObj } from '@storybook/react';
import { DropdownMenu } from '@gideon-defender/ui/dropdown-menu';

const meta = {
  title: 'Tier 1 — DropdownMenu',
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
  },
};
