import type { Meta, StoryObj } from '@storybook/react';
import { ResidualAcceptanceCard } from '../../../../../apps/app/src/components/risks/acceptance/ResidualAcceptanceCard';

const meta = {
  title: 'Tier 2 — ResidualAcceptanceCard',
  component: ResidualAcceptanceCard,
} satisfies Meta<typeof ResidualAcceptanceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    kind: 'risk',
    subjectId: 'demo_id',
    residualLikelihood: 'very_unlikely',
    residualImpact: 'insignificant',
    ownerId: 'demo_id',
    acceptorOptions: [{ id: 'demo_id_1', name: 'Example name 1' }, { id: 'demo_id_2', name: 'Example name 2' }, { id: 'demo_id_3', name: 'Example name 3' }],
    canUpdate: true,
  },
};
