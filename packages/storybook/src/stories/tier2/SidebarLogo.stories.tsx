import type { Meta, StoryObj } from '@storybook/react';
import { SidebarLogo } from '../../../../../apps/app/src/components/sidebar-logo';

const meta = {
  title: 'Tier 2 — SidebarLogo',
  component: SidebarLogo,
} satisfies Meta<typeof SidebarLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    isCollapsed: true,
  },
};
