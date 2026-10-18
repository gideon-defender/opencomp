import type { Meta, StoryObj } from '@storybook/react';
import { VerifyRiskAssessmentTaskItemSkeletonRow } from '../../../../../apps/app/src/components/task-items/verify-risk-assessment/VerifyRiskAssessmentTaskItemSkeletonRow';

const meta = {
  title: 'Tier 2 — VerifyRiskAssessmentTaskItemSkeletonRow',
  component: VerifyRiskAssessmentTaskItemSkeletonRow,
} satisfies Meta<typeof VerifyRiskAssessmentTaskItemSkeletonRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
