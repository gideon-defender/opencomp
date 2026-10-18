import type { Meta, StoryObj } from '@storybook/react';
import { TaskSmartForm } from '../../../../../apps/app/src/components/task-items/TaskSmartForm';

const meta = {
  title: 'Tier 2 — TaskSmartForm',
  component: TaskSmartForm,
} satisfies Meta<typeof TaskSmartForm>;

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
