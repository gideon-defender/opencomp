import type { Meta, StoryObj } from '@storybook/react';
import { VendorRiskAssessmentView } from '../../../../../apps/app/src/components/vendor-risk-assessment/VendorRiskAssessmentView';

const meta = {
  title: 'Tier 2 — VendorRiskAssessmentView',
  component: VendorRiskAssessmentView,
} satisfies Meta<typeof VendorRiskAssessmentView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    source: { title: 'Example title', description: 'Example description', createdAt: '2026-01-01T00:00:00.000Z' },
  },
};
