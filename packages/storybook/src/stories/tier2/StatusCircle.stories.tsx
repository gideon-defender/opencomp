import type { Meta, StoryObj } from '@storybook/react';
import { StatusCircle } from '../../../../../apps/app/src/components/task-items/StatusCircle';

const meta = {
  title: 'Tier 2 — StatusCircle',
  component: StatusCircle,
} satisfies Meta<typeof StatusCircle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    status: 'done',
  },
};
