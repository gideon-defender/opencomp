import type { Meta, StoryObj } from '@storybook/react';
import { TaskItemEditableTitle } from '../../../../../apps/app/src/components/task-items/TaskItemEditableTitle';

const meta = {
  title: 'Tier 2 — TaskItemEditableTitle',
  component: TaskItemEditableTitle,
} satisfies Meta<typeof TaskItemEditableTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    isUpdating: true,
    onUpdate: async () => {},
    readOnly: false,
  },
};
