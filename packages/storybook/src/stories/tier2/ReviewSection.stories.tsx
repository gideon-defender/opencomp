import type { Meta, StoryObj } from '@storybook/react';
import { ReviewSection } from '../../../../../apps/app/src/components/ReviewSection';

const meta = {
  title: 'Tier 2 — ReviewSection',
  component: ReviewSection,
} satisfies Meta<typeof ReviewSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    rating: 42,
    reviewCount: 42,
  },
};
