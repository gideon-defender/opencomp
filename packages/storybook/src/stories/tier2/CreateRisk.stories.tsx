import type { Meta, StoryObj } from '@storybook/react';
import { CreateRisk } from '../../../../../apps/app/src/components/forms/risks/create-risk-form';

const meta = {
  title: 'Tier 2 — CreateRisk',
  component: CreateRisk,
} satisfies Meta<typeof CreateRisk>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    assignees: [],
  },
};
