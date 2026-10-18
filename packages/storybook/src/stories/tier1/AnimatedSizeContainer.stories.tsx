import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedSizeContainer } from '@gideon-defender/ui/animated-size-container';

const meta = {
  title: 'Tier 1 — AnimatedSizeContainer',
  component: AnimatedSizeContainer,
} satisfies Meta<typeof AnimatedSizeContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    width: false,
    height: false,
    children: 'Example content',
  },
};
