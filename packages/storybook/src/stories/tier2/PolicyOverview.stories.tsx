import type { Meta, StoryObj } from '@storybook/react';
import { PolicyOverview } from '../../../../../apps/app/src/components/policies/charts/policy-overview';

const meta = {
  title: 'Tier 2 — PolicyOverview',
  component: PolicyOverview,
} satisfies Meta<typeof PolicyOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data: { policies: 42, draftPolicies: 42, publishedPolicies: 42, needsReviewPolicies: 42 },
  },
};
