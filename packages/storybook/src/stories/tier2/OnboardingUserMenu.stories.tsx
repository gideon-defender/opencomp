import type { Meta, StoryObj } from '@storybook/react';
import { OnboardingUserMenu } from '../../../../../apps/app/src/components/layout/OnboardingUserMenu';

const meta = {
  title: 'Tier 2 — OnboardingUserMenu',
  component: OnboardingUserMenu,
} satisfies Meta<typeof OnboardingUserMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    user: { id: 'demo_id', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), email: 'person@example.com', emailVerified: true, name: 'Example name' },
  },
};
