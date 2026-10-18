import type { Meta, StoryObj } from '@storybook/react';
import { Carousel } from '@gideon-defender/ui/carousel';

const meta = {
  title: 'Tier 1 — Carousel',
  component: Carousel,
} satisfies Meta<typeof Carousel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    orientation: 'horizontal',
  },
};
