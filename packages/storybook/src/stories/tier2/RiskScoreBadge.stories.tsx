import type { Meta, StoryObj } from '@storybook/react';
import { RiskScoreBadge } from '../../../../../apps/app/src/components/risks/RiskScoreBadge';

const meta = {
  title: 'Tier 2 — RiskScoreBadge',
  component: RiskScoreBadge,
} satisfies Meta<typeof RiskScoreBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    score: 42,
    likelihood: 'very_unlikely',
    impact: 'insignificant',
    labelOnly: false,
  },
};
