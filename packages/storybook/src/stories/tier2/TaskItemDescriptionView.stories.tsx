import type { Meta, StoryObj } from '@storybook/react';
import { TaskItemDescriptionView } from '../../../../../apps/app/src/components/task-items/TaskItemDescriptionView';

const meta = {
  title: 'Tier 2 — TaskItemDescriptionView',
  component: TaskItemDescriptionView,
} satisfies Meta<typeof TaskItemDescriptionView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    description: 'Example description',
  },
};
