import type { Meta, StoryObj } from '@storybook/react';
import { MarketingHeader } from '../../../../../apps/app/src/components/marketing-empty-state/MarketingHeader';

const meta = {
  title: 'Tier 2 — MarketingHeader',
  component: MarketingHeader,
} satisfies Meta<typeof MarketingHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    description: 'Example description',
    lockLabel: 'Example title',
    statusText: 'Example description',
  },
};
