import type { Meta, StoryObj } from '@storybook/react';
import { SchedulePicker } from '../../../../../apps/app/src/components/schedule-picker';

const meta = {
  title: 'Tier 2 — SchedulePicker',
  component: SchedulePicker,
} satisfies Meta<typeof SchedulePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 'monthly',
    onChange: () => {},
    disabled: false,
  },
};
