import type { Meta, StoryObj } from '@storybook/react';
import { MarketingEmptyState } from '../../../../../apps/app/src/components/marketing-empty-state/MarketingEmptyState';

const meta = {
  title: 'Tier 2 — MarketingEmptyState',
  component: MarketingEmptyState,
} satisfies Meta<typeof MarketingEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'Example content',
  },
};
