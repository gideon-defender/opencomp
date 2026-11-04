import type { Meta, StoryObj } from '@storybook/react';
import { SidebarCollapseButton } from '../../../../../apps/app/src/components/sidebar-collapse-button';
import { withSidebar } from '../../mocks/decorators';

const meta = {
  title: 'Tier 2 — SidebarCollapseButton',
  component: SidebarCollapseButton,
  decorators: [withSidebar],
} satisfies Meta<typeof SidebarCollapseButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
