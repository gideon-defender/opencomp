import { AlertDialog } from '@gideon-defender/ui/alert-dialog';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — AlertDialog',
  component: AlertDialog,
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
  },
};
