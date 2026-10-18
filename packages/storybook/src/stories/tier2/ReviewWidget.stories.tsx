import type { Meta, StoryObj } from '@storybook/react';
import { ReviewWidget } from '../../../../../apps/app/src/components/review-widget';

const meta = {
  title: 'Tier 2 — ReviewWidget',
  component: ReviewWidget,
} satisfies Meta<typeof ReviewWidget>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    rating: 42,
    reviewCount: 42,
  },
};
