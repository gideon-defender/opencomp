import type { Meta, StoryObj } from '@storybook/react';
import { MatrixBody } from '../../../../../apps/app/src/components/risks/charts/MatrixBody';

const meta = {
  title: 'Tier 2 — MatrixBody',
  component: MatrixBody,
} satisfies Meta<typeof MatrixBody>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    riskData: [{ probability: 'Example 1', impact: 'Example 1', level: 'high' }, { probability: 'Example 2', impact: 'Example 2', level: 'high' }, { probability: 'Example 3', impact: 'Example 3', level: 'high' }],
    handleCellClick: () => {},
    readOnly: false,
    suggestedLikelihood: 'very_unlikely',
    suggestedImpact: 'insignificant',
  },
};
