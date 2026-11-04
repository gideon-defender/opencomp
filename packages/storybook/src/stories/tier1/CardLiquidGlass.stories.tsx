import { CardLiquidGlass } from '@gideon-defender/ui/card-liquid-glass';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — CardLiquidGlass',
  component: CardLiquidGlass,
} satisfies Meta<typeof CardLiquidGlass>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
