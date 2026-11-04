import { Sheet } from '@gideon-defender/ui/sheet';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — Sheet',
  component: Sheet,
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
  },
};
