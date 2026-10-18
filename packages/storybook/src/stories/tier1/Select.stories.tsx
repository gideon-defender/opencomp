import type { Meta, StoryObj } from '@storybook/react';
import { Select } from '@gideon-defender/ui/select';

const meta = {
  title: 'Tier 1 — Select',
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    open: false,
  },
};
