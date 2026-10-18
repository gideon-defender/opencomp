import type { Meta, StoryObj } from '@storybook/react';
import { TaskItems } from '../../../../../apps/app/src/components/task-items/TaskItems';

const meta = {
  title: 'Tier 2 — TaskItems',
  component: TaskItems,
} satisfies Meta<typeof TaskItems>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    entityId: 'demo_id',
    entityType: 'risk',
    title: 'Example title',
    description: 'Example description',
    anchorId: 'demo_id',
  },
};
