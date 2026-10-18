import type { Meta, StoryObj } from '@storybook/react';
import { DepartmentChart } from '../../../../../apps/app/src/components/risks/charts/department-chart';

const meta = {
  title: 'Tier 2 — DepartmentChart',
  component: DepartmentChart,
} satisfies Meta<typeof DepartmentChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data: [{ name: 'Example name 1', value: 42 }, { name: 'Example name 2', value: 28 }, { name: 'Example name 3', value: 15 }],
    showEmptyDepartments: false,
  },
};
