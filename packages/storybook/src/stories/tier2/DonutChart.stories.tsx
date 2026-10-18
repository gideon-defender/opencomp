import type { Meta, StoryObj } from '@storybook/react';
import { DonutChart } from '../../../../../apps/app/src/components/risks/charts/donut-chart';

const meta = {
  title: 'Tier 2 — DonutChart',
  component: DonutChart,
} satisfies Meta<typeof DonutChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data: [{ name: 'Example name 1', value: 42 }, { name: 'Example name 2', value: 28 }, { name: 'Example name 3', value: 15 }],
    colors: ['Example 1', 'Example 2', 'Example 3'],
    showLabels: false,
  },
};
