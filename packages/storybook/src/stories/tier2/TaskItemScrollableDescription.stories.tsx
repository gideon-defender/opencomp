import type { Meta, StoryObj } from '@storybook/react';
import { TaskItemScrollableDescription } from '../../../../../apps/app/src/components/task-items/TaskItemScrollableDescription';

const meta = {
  title: 'Tier 2 — TaskItemScrollableDescription',
  component: TaskItemScrollableDescription,
} satisfies Meta<typeof TaskItemScrollableDescription>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    description: 'Example description',
    maxHeightClass: 'Example',
  },
};
