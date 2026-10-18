import type { Meta, StoryObj } from '@storybook/react';
import { RecordAcceptanceDialog } from '../../../../../apps/app/src/components/risks/acceptance/RecordAcceptanceDialog';

const meta = {
  title: 'Tier 2 — RecordAcceptanceDialog',
  component: RecordAcceptanceDialog,
} satisfies Meta<typeof RecordAcceptanceDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    subjectLabel: 'Example title',
    residualLevelLabel: 'Example title',
    acceptorOptions: [{ id: 'demo_id_1', name: 'Example name 1' }, { id: 'demo_id_2', name: 'Example name 2' }, { id: 'demo_id_3', name: 'Example name 3' }],
    defaultAcceptorId: 'demo_id',
    onRecord: async () => {},
  },
};
