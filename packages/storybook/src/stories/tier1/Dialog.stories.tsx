import type { Meta, StoryObj } from '@storybook/react';
import { Dialog } from '@gideon-defender/ui/dialog';

const meta = {
  title: 'Tier 1 — Dialog',
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
  },
};
