import type { Meta, StoryObj } from '@storybook/react';
import { TaskItemsHeader } from '../../../../../apps/app/src/components/task-items/TaskItemsHeader';

const meta = {
  title: 'Tier 2 — TaskItemsHeader',
  component: TaskItemsHeader,
} satisfies Meta<typeof TaskItemsHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    description: 'Example description',
    statsLoading: true,
    isCreateOpen: true,
    onToggleCreate: () => {},
  },
};
