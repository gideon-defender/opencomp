import type { Meta, StoryObj } from '@storybook/react';
import { Progress } from '@gideon-defender/ui/progress';

const meta = {
  title: 'Tier 1 — Progress',
  component: Progress,
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
