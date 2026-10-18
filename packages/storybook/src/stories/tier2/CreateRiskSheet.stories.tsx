import type { Meta, StoryObj } from '@storybook/react';
import { CreateRiskSheet } from '../../../../../apps/app/src/components/sheets/create-risk-sheet';

const meta = {
  title: 'Tier 2 — CreateRiskSheet',
  component: CreateRiskSheet,
} satisfies Meta<typeof CreateRiskSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    assignees: [],
  },
};
