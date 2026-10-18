import type { Meta, StoryObj } from '@storybook/react';
import { MarketingHero } from '../../../../../apps/app/src/components/marketing-empty-state/MarketingHero';

const meta = {
  title: 'Tier 2 — MarketingHero',
  component: MarketingHero,
} satisfies Meta<typeof MarketingHero>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    paragraphs: ['Example content', 'Example content', 'Example content'],
    eyebrow: 'Example',
    titleBefore: 'Example title',
    accentWord: 'Example',
    titleAfter: 'Example title',
    previewAnnotation: 'Example',
  },
};
