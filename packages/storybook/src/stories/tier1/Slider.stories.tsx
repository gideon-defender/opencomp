import { Slider } from '@gideon-defender/ui/slider';
import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Tier 1 — Slider',
  component: Slider,
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
