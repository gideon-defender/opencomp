import type { Meta, StoryObj } from '@storybook/react';
import { withDropdownMenu } from '../../mocks/decorators';
import { SignOut } from '../../../../../apps/app/src/components/sign-out';

const meta = {
  title: 'Tier 2 — SignOut',
  component: SignOut,
  decorators: [withDropdownMenu],
} satisfies Meta<typeof SignOut>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    asButton: false,
    size: 'default',
  },
};
