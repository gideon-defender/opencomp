import type { Meta, StoryObj } from '@storybook/react';
import { VendorRiskAssessmentCertificationsCard } from '../../../../../apps/app/src/components/vendor-risk-assessment/VendorRiskAssessmentCertificationsCard';

const meta = {
  title: 'Tier 2 — VendorRiskAssessmentCertificationsCard',
  component: VendorRiskAssessmentCertificationsCard,
} satisfies Meta<typeof VendorRiskAssessmentCertificationsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    certifications: [{ type: 'Example 1', status: 'unknown' }, { type: 'Example 2', status: 'unknown' }, { type: 'Example 3', status: 'unknown' }],
    verifiedCount: 42,
    previewCount: 42,
  },
};
