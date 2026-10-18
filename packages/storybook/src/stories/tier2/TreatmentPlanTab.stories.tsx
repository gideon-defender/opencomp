import type { Meta, StoryObj } from '@storybook/react';
import { TreatmentPlanTab } from '../../../../../apps/app/src/components/risks/treatment-plan/TreatmentPlanTab';

const meta = {
  title: 'Tier 2 — TreatmentPlanTab',
  component: TreatmentPlanTab,
} satisfies Meta<typeof TreatmentPlanTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    orgId: 'demo_id',
    entity: { id: 'demo_id', inherentLikelihood: 'very_unlikely', inherentImpact: 'insignificant', residualLikelihood: 'very_unlikely', residualImpact: 'insignificant', treatmentStrategy: 'accept', treatmentStrategyDescription: 'Example description', tasks: [{ id: 'demo_id_1', title: 'Example title 1', status: 'done', controls: [] }, { id: 'demo_id_2', title: 'Example title 2', status: 'done', controls: [] }, { id: 'demo_id_3', title: 'Example title 3', status: 'done', controls: [] }] },
    canUpdate: true,
    onUpdateStrategy: async () => {},
    onUpdateDescription: async () => {},
    onRegenerate: async () => {},
    regenerating: true,
  },
};
