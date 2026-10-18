import type { Meta, StoryObj } from '@storybook/react';
import { VendorRiskAssessmentTimelineCard } from '../../../../../apps/app/src/components/vendor-risk-assessment/VendorRiskAssessmentTimelineCard';

const meta = {
  title: 'Tier 2 — VendorRiskAssessmentTimelineCard',
  component: VendorRiskAssessmentTimelineCard,
} satisfies Meta<typeof VendorRiskAssessmentTimelineCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    news: [{ date: '2026-01-01T00:00:00.000Z', title: 'Example title 1' }, { date: '2026-01-01T00:00:00.000Z', title: 'Example title 2' }, { date: '2026-01-01T00:00:00.000Z', title: 'Example title 3' }],
    previewCount: 42,
  },
};
