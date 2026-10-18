import type { Meta, StoryObj } from '@storybook/react';
import { SkeletonLoader } from '../../../../../apps/app/src/components/skeleton-loader';

const meta = {
  title: 'Tier 2 — SkeletonLoader',
  component: SkeletonLoader,
} satisfies Meta<typeof SkeletonLoader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    amount: 42,
    prefix: 'Example',
  },
};
