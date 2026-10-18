import type { Meta, StoryObj } from '@storybook/react';
import { Label } from '@gideon-defender/ui/label';

const meta = {
  title: 'Tier 1 — Label',
  component: Label,
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
