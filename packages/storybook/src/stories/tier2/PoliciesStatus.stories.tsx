import type { Meta, StoryObj } from '@storybook/react';
import { PoliciesStatus } from '../../../../../apps/app/src/components/policies/charts/policies-status';

const meta = {
  title: 'Tier 2 — PoliciesStatus',
  component: PoliciesStatus,
} satisfies Meta<typeof PoliciesStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    totalPolicies: 42,
    publishedPolicies: 42,
    draftPolicies: 42,
    archivedPolicies: 42,
    needsReviewPolicies: 42,
  },
};
