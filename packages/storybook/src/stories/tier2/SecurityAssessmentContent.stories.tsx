import type { Meta, StoryObj } from '@storybook/react';
import { SecurityAssessmentContent } from '../../../../../apps/app/src/components/vendor-risk-assessment/SecurityAssessmentContent';

const meta = {
  title: 'Tier 2 — SecurityAssessmentContent',
  component: SecurityAssessmentContent,
} satisfies Meta<typeof SecurityAssessmentContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    text: 'Example description',
    maxLength: 42,
  },
};
