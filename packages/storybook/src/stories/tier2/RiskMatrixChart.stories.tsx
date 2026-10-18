import type { Meta, StoryObj } from '@storybook/react';
import { RiskMatrixChart } from '../../../../../apps/app/src/components/risks/charts/RiskMatrixChart';

const meta = {
  title: 'Tier 2 — RiskMatrixChart',
  component: RiskMatrixChart,
} satisfies Meta<typeof RiskMatrixChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Example title',
    description: 'Example description',
    riskId: 'demo_id',
    activeLikelihood: 'very_unlikely',
    activeImpact: 'insignificant',
    saveAction: async () => {},
    readOnly: false,
    suggestedLikelihood: 'very_unlikely',
    suggestedImpact: 'insignificant',
    titleInfo: 'Example title',
    preliminary: false,
  },
};
