import type { Meta, StoryObj } from '@storybook/react';
import { MarketingSection } from '../../../../../apps/app/src/components/marketing-empty-state/MarketingSection';

const meta = {
  title: 'Tier 2 — MarketingSection',
  component: MarketingSection,
} satisfies Meta<typeof MarketingSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    children: 'Example content',
    note: 'Example',
  },
};
