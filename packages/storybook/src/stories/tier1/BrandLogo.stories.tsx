import type { Meta, StoryObj } from '@storybook/react';
import { BrandLogo } from '@gideon-defender/ui/brand-logo';

const meta = {
  title: 'Tier 1 — BrandLogo',
  component: BrandLogo,
} satisfies Meta<typeof BrandLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    showText: false,
    iconSize: 42,
  },
};
