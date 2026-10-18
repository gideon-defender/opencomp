import type { Meta, StoryObj } from '@storybook/react';
import { RiskMatrix5x5 } from '../../../../../apps/app/src/components/risks/treatment-plan/RiskMatrix5x5';

const meta = {
  title: 'Tier 2 — RiskMatrix5x5',
  component: RiskMatrix5x5,
} satisfies Meta<typeof RiskMatrix5x5>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    inherentLikelihood: 'very_unlikely',
    inherentImpact: 'insignificant',
    residualLikelihood: 'very_unlikely',
    residualImpact: 'insignificant',
    completion: 42,
    preliminary: false,
  },
};
