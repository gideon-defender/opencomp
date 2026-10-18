import type { Meta, StoryObj } from '@storybook/react';
import { PieChart } from '../../../../../apps/app/src/components/ui/pie-chart';

const meta = {
  title: 'Tier 2 — PieChart',
  component: PieChart,
} satisfies Meta<typeof PieChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data: [{ name: 'Example name 1', value: 42, color: '#1d4e3f' }, { name: 'Example name 2', value: 28, color: '#2f8f6f' }, { name: 'Example name 3', value: 15, color: '#7fc2ab' }],
  },
};
