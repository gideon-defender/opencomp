import type { Meta, StoryObj } from '@storybook/react';
import { VendorRiskAssessmentSkeleton } from '../../../../../apps/app/src/components/vendor-risk-assessment/VendorRiskAssessmentSkeleton';

const meta = {
  title: 'Tier 2 — VendorRiskAssessmentSkeleton',
  component: VendorRiskAssessmentSkeleton,
} satisfies Meta<typeof VendorRiskAssessmentSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
