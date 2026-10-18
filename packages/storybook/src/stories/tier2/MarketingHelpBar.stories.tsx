import type { Meta, StoryObj } from '@storybook/react';
import { MarketingHelpBar } from '../../../../../apps/app/src/components/marketing-empty-state/MarketingHelpBar';

const meta = {
  title: 'Tier 2 — MarketingHelpBar',
  component: MarketingHelpBar,
} satisfies Meta<typeof MarketingHelpBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    body: 'Example description',
  },
};
