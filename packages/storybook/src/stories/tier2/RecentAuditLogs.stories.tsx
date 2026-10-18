import type { Meta, StoryObj } from '@storybook/react';
import { RecentAuditLogs } from '../../../../../apps/app/src/components/RecentAuditLogs';

const meta = {
  title: 'Tier 2 — RecentAuditLogs',
  component: RecentAuditLogs,
} satisfies Meta<typeof RecentAuditLogs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    logs: [],
    title: 'Example title',
    total: 42,
    hasMore: false,
    isLoadingMore: false,
  },
};
