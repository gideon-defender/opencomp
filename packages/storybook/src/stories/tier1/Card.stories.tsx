import type { Meta, StoryObj } from '@storybook/react';
import { Card } from '@gideon-defender/ui/card';

const meta = {
  title: 'Tier 1 — Card',
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
