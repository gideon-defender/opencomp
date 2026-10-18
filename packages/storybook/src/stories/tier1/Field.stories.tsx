import type { Meta, StoryObj } from '@storybook/react';
import { Field } from '@gideon-defender/ui/field';

const meta = {
  title: 'Tier 1 — Field',
  component: Field,
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    orientation: 'horizontal',
  },
};
