import type { Meta, StoryObj } from '@storybook/react';
import { VendorStatus } from '../../../../../apps/app/src/components/vendor-status';

const meta = {
  title: 'Tier 2 — VendorStatus',
  component: VendorStatus,
} satisfies Meta<typeof VendorStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    status: 'in_progress',
  },
};
