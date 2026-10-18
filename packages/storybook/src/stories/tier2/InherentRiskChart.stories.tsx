import type { Meta, StoryObj } from '@storybook/react';
import { InherentRiskChart } from '../../../../../apps/app/src/components/risks/charts/InherentRiskChart';

const meta = {
  title: 'Tier 2 — InherentRiskChart',
  component: InherentRiskChart,
} satisfies Meta<typeof InherentRiskChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    risk: { id: 'demo_id', organizationId: 'demo_id', description: 'Example description', assigneeId: 'demo_id', createdAt: new Date('2026-01-01T00:00:00.000Z'), department: 'Example', title: 'Example title', status: 'open', updatedAt: new Date('2026-01-01T00:00:00.000Z'), category: 'people', likelihood: 'very_unlikely', impact: 'insignificant', residualLikelihood: 'very_unlikely', residualImpact: 'insignificant', treatmentStrategyDescription: 'Example description', treatmentStrategy: 'accept', strategyDescriptions: 'Example description', autoLinkRunId: 'demo_id', autoLinkRunStartedAt: new Date('2026-01-01T00:00:00.000Z'), embeddingHash: 'Example' },
  },
};
