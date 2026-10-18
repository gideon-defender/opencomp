import type { Meta, StoryObj } from '@storybook/react';
import { TaskItemFocusView } from '../../../../../apps/app/src/components/task-items/TaskItemFocusView';

const meta = {
  title: 'Tier 2 — TaskItemFocusView',
  component: TaskItemFocusView,
} satisfies Meta<typeof TaskItemFocusView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    taskItem: { id: 'demo_id', title: 'Example title', description: 'Example description', status: 'done', priority: 'high', entityId: 'demo_id', entityType: 'risk', assignee: { id: 'demo_id', user: { id: 'demo_id', name: 'Example name', email: 'person@example.com', image: 'Example' } }, createdBy: { id: 'demo_id', user: { id: 'demo_id', name: 'Example name', email: 'person@example.com', image: 'Example' } }, updatedBy: { id: 'demo_id', user: { id: 'demo_id', name: 'Example name', email: 'person@example.com', image: 'Example' } }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    entityId: 'demo_id',
    entityType: 'risk',
    onBack: () => {},
    page: 42,
    limit: 42,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  },
};
