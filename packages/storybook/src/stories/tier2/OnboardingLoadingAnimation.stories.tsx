import type { Meta, StoryObj } from '@storybook/react';
import { OnboardingLoadingAnimation } from '../../../../../apps/app/src/components/onboarding-loading-animation';

const meta = {
  title: 'Tier 2 — OnboardingLoadingAnimation',
  component: OnboardingLoadingAnimation,
} satisfies Meta<typeof OnboardingLoadingAnimation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    itemType: 'risks',
    title: 'Example title',
    description: 'Example description',
  },
};
