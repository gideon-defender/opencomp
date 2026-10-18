import type { Meta, StoryObj } from '@storybook/react';
import { ResidualRiskForm } from '../../../../../apps/app/src/components/forms/risks/ResidualRiskForm';

const meta = {
  title: 'Tier 2 — ResidualRiskForm',
  component: ResidualRiskForm,
  parameters: {
    searchParams: { 'residual-risk-sheet': 'true' },
  },
} satisfies Meta<typeof ResidualRiskForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    riskId: 'demo_id',
    initialProbability: 'very_unlikely',
    initialImpact: 'insignificant',
  },
};
