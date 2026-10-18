import type { Meta, StoryObj } from '@storybook/react';
import { MarkExceptionModal } from '../../../../../apps/app/src/components/integrations/MarkExceptionModal';

const meta = {
  title: 'Tier 2 — MarkExceptionModal',
  component: MarkExceptionModal,
} satisfies Meta<typeof MarkExceptionModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    findingId: 'demo_id',
    findingTitle: 'Example title',
    resourceLabel: 'Example title',
    title: 'Example title',
    description: 'Example description',
    confirmLabel: 'Example title',
    reasonLabel: 'Example title',
    expiryHint: 'Example',
    successToast: 'Example',
  },
};
