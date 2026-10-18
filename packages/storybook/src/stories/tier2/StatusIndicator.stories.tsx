import type { Meta, StoryObj } from '@storybook/react';
import { StatusIndicator } from '../../../../../apps/app/src/components/status-indicator';

const meta = {
  title: 'Tier 2 — StatusIndicator',
  component: StatusIndicator,
} satisfies Meta<typeof StatusIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    status: 'done',
    withLabel: false,
  },
};
