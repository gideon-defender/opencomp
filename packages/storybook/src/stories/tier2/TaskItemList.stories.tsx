import type { Meta, StoryObj } from '@storybook/react';
import { TaskItemList } from '../../../../../apps/app/src/components/task-items/TaskItemList';

const meta = {
  title: 'Tier 2 — TaskItemList',
  component: TaskItemList,
} satisfies Meta<typeof TaskItemList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    taskItems: [],
    entityId: 'demo_id',
    entityType: 'risk',
    page: 42,
    limit: 42,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
};
