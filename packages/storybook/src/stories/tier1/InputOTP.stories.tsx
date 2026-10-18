import type { Meta, StoryObj } from '@storybook/react';
import { InputOTP } from '@gideon-defender/ui/input-otp';

const meta = {
  title: 'Tier 1 — InputOTP',
  component: InputOTP,
} satisfies Meta<typeof InputOTP>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    maxLength: 42,
    render: () => ('Example content'),
    children: undefined,
  },
};
