import type { Meta, StoryObj } from '@storybook/react';
import { QuantityInput } from '@gideon-defender/ui/quantity-input';

const meta = {
  title: 'Tier 1 — QuantityInput',
  component: QuantityInput,
} satisfies Meta<typeof QuantityInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 42,
    min: 42,
    max: 42,
  },
};
