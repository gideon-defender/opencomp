import type { Meta, StoryObj } from '@storybook/react';
import { AuthErrorNotice } from '@gideon-defender/ui/auth-error-notice';

const meta = {
  title: 'Tier 1 — AuthErrorNotice',
  component: AuthErrorNotice,
} satisfies Meta<typeof AuthErrorNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    description: 'Example description',
  },
};
