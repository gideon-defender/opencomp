import { NavigationMenu } from '@gideon-defender/ui/navigation-menu';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — NavigationMenu',
  component: NavigationMenu,
} satisfies Meta<typeof NavigationMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
