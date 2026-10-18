import type { Meta, StoryObj } from '@storybook/react';
import { EmployeeStatus } from '../../../../../apps/app/src/components/tables/people/employee-status';

const meta = {
  title: 'Tier 2 — EmployeeStatus',
  component: EmployeeStatus,
} satisfies Meta<typeof EmployeeStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    status: 'active',
  },
};
