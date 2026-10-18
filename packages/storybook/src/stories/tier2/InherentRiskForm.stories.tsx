import type { Meta, StoryObj } from '@storybook/react';
import { InherentRiskForm } from '../../../../../apps/app/src/components/forms/risks/InherentRiskForm';

const meta = {
  title: 'Tier 2 — InherentRiskForm',
  component: InherentRiskForm,
  parameters: {
    searchParams: { 'inherent-risk-sheet': 'true' },
  },
} satisfies Meta<typeof InherentRiskForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    riskId: 'demo_id',
    initialProbability: 'very_unlikely',
    initialImpact: 'insignificant',
  },
};
