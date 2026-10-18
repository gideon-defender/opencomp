import type { Meta, StoryObj } from '@storybook/react';
import { PolicyAcknowledgmentInvalidationDialog } from '../../../../../apps/app/src/components/policies/PolicyAcknowledgmentInvalidationDialog';

const meta = {
  title: 'Tier 2 — PolicyAcknowledgmentInvalidationDialog',
  component: PolicyAcknowledgmentInvalidationDialog,
} satisfies Meta<typeof PolicyAcknowledgmentInvalidationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    acknowledgmentCount: 42,
    onConfirm: () => {},
    onOpenChange: () => {},
    open: true,
    actionDescription: 'Example description',
    confirmText: 'Example description',
    isLoading: false,
  },
};
