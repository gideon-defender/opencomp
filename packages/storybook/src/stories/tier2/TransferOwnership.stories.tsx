import type { Meta, StoryObj } from '@storybook/react';
import { TransferOwnership } from '../../../../../apps/app/src/components/forms/organization/transfer-ownership';

const meta = {
  title: 'Tier 2 — TransferOwnership',
  component: TransferOwnership,
} satisfies Meta<typeof TransferOwnership>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    isOwner: true,
  },
};
