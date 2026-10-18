import type { Meta, StoryObj } from '@storybook/react';
import { NotificationBell } from '../../../../../apps/app/src/components/notifications/notification-bell';

const meta = {
  title: 'Tier 2 — NotificationBell',
  component: NotificationBell,
} satisfies Meta<typeof NotificationBell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
