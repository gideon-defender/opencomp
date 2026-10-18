import type { Meta, StoryObj } from '@storybook/react';
import { LoginForm } from '../../../../../apps/app/src/components/login-form';

const meta = {
  title: 'Tier 2 — LoginForm',
  component: LoginForm,
} satisfies Meta<typeof LoginForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    inviteCode: 'Example',
    redirectTo: 'Example',
  },
};
