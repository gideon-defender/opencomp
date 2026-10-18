import type { Meta, StoryObj } from '@storybook/react';
import { TaskItemForm } from '../../../../../apps/app/src/components/task-items/TaskItemForm';

const meta = {
  title: 'Tier 2 — TaskItemForm',
  component: TaskItemForm,
} satisfies Meta<typeof TaskItemForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    entityId: 'demo_id',
    entityType: 'risk',
    page: 42,
    limit: 42,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
};
