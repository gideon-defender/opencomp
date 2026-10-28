import { CurrencyInput } from '@gideon-defender/ui/currency-input';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — CurrencyInput',
  component: CurrencyInput,
} satisfies Meta<typeof CurrencyInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
