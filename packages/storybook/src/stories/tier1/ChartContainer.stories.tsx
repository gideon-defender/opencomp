import type { Meta, StoryObj } from '@storybook/react';
import { ChartContainer } from '@gideon-defender/ui/chart';

const meta = {
  title: 'Tier 1 — ChartContainer',
  component: ChartContainer,
} satisfies Meta<typeof ChartContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: <div>Example content</div>,
    config: {  },
  },
};
