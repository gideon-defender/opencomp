import type { Meta, StoryObj } from '@storybook/react';
import { TreatmentHero } from '../../../../../apps/app/src/components/risks/treatment-plan/TreatmentHero';

const meta = {
  title: 'Tier 2 — TreatmentHero',
  component: TreatmentHero,
} satisfies Meta<typeof TreatmentHero>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    inherentLikelihood: 'very_unlikely',
    inherentImpact: 'insignificant',
    strategy: 'accept',
    tasks: [{ status: 'done' }, { status: 'done' }, { status: 'done' }],
    residualLikelihood: 'very_unlikely',
    residualImpact: 'insignificant',
    isEmpty: false,
  },
};
