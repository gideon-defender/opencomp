import type { Meta, StoryObj } from '@storybook/react';
import { Shimmer } from '../../../../../apps/app/src/components/ai-elements/shimmer';

const meta = {
  title: 'Tier 2 — Shimmer',
  component: Shimmer,
} satisfies Meta<typeof Shimmer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example',
    duration: 42,
    spread: 42,
  },
};
