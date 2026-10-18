import type { Meta, StoryObj } from '@storybook/react';
import { AssessmentChart } from '../../../../../apps/app/src/components/risks/charts/assessment';

const meta = {
  title: 'Tier 2 — AssessmentChart',
  component: AssessmentChart,
} satisfies Meta<typeof AssessmentChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
