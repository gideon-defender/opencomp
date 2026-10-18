import type { Meta, StoryObj } from '@storybook/react';
import { ScoreExplainer } from '../../../../../apps/app/src/components/risks/treatment-plan/ScoreExplainer';

const meta = {
  title: 'Tier 2 — ScoreExplainer',
  component: ScoreExplainer,
} satisfies Meta<typeof ScoreExplainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
