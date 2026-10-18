import type { Meta, StoryObj } from '@storybook/react';
import { CheckoutCompleteDialog } from '../../../../../apps/app/src/components/dialogs/checkout-complete-dialog';

const meta = {
  title: 'Tier 2 — CheckoutCompleteDialog',
  component: CheckoutCompleteDialog,
  parameters: {
    searchParams: { checkoutComplete: 'starter' },
  },
} satisfies Meta<typeof CheckoutCompleteDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    orgId: 'demo_id',
  },
};
