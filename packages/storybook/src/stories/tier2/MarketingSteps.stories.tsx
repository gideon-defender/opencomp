import type { Meta, StoryObj } from '@storybook/react';
import { MarketingSteps } from '../../../../../apps/app/src/components/marketing-empty-state/MarketingSteps';

const meta = {
  title: 'Tier 2 — MarketingSteps',
  component: MarketingSteps,
} satisfies Meta<typeof MarketingSteps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    steps: [{ number: 'Example 1', title: 'Example title 1', description: 'Example description 1' }, { number: 'Example 2', title: 'Example title 2', description: 'Example description 2' }, { number: 'Example 3', title: 'Example title 3', description: 'Example description 3' }],
  },
};
