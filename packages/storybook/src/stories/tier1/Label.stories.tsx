import { Label } from '@gideon-defender/ui/label';
import type { Meta, StoryObj } from '@storybook/react';

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
