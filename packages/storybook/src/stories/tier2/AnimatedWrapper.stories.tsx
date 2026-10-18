import type { Meta, StoryObj } from '@storybook/react';
import { AnimatedWrapper } from '../../../../../apps/app/src/components/animated-wrapper';

const meta = {
  title: 'Tier 2 — AnimatedWrapper',
  component: AnimatedWrapper,
} satisfies Meta<typeof AnimatedWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
    delay: 42,
    direction: 'up',
    duration: 42,
    animationKey: 'Example',
  },
};
