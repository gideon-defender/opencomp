import type { Meta, StoryObj } from '@storybook/react';
import { StatusChart } from '../../../../../apps/app/src/components/risks/charts/status-chart';

const meta = {
  title: 'Tier 2 — StatusChart',
  component: StatusChart,
} satisfies Meta<typeof StatusChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data: [{ name: 'Example name 1', value: 42 }, { name: 'Example name 2', value: 28 }, { name: 'Example name 3', value: 15 }],
  },
};
