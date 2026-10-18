import type { Meta, StoryObj } from '@storybook/react';
import { TaskItemCreateDialog } from '../../../../../apps/app/src/components/task-items/TaskItemCreateDialog';

const meta = {
  title: 'Tier 2 — TaskItemCreateDialog',
  component: TaskItemCreateDialog,
} satisfies Meta<typeof TaskItemCreateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    entityId: 'demo_id',
    entityType: 'risk',
    page: 42,
    limit: 42,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    filters: {  },
    onSuccess: () => {},
  },
};
