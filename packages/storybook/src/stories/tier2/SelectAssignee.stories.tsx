import type { Meta, StoryObj } from '@storybook/react';
import { SelectAssignee } from '../../../../../apps/app/src/components/SelectAssignee';

const meta = {
  title: 'Tier 2 — SelectAssignee',
  component: SelectAssignee,
} satisfies Meta<typeof SelectAssignee>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    assigneeId: 'demo_id',
    assignees: [],
    onAssigneeChange: () => {},
    disabled: false,
    withTitle: false,
  },
};
