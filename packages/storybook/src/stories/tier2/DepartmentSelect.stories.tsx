import type { Meta, StoryObj } from '@storybook/react';
import { DepartmentSelect } from '../../../../../apps/app/src/components/DepartmentSelect';

const meta = {
  title: 'Tier 2 — DepartmentSelect',
  component: DepartmentSelect,
} satisfies Meta<typeof DepartmentSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 'Example',
    onChange: () => {},
    disabled: false,
    placeholder: 'Example',
    customDepartments: ['Example 1', 'Example 2', 'Example 3'],
  },
};
