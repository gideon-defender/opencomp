import type { Meta, StoryObj } from '@storybook/react';
import { RiskScale } from '../../../../../apps/app/src/components/risks/treatment-plan/RiskScale';

const meta = {
  title: 'Tier 2 — RiskScale',
  component: RiskScale,
} satisfies Meta<typeof RiskScale>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    inherentScore: 42,
    residualScore: 42,
    inherentColor: '#1d4e3f',
    residualColor: '#1d4e3f',
  },
};
