import type { Meta, StoryObj } from '@storybook/react';
import { CreatePolicySheet } from '../../../../../apps/app/src/components/sheets/create-policy-sheet';

const meta = {
  title: 'Tier 2 — CreatePolicySheet',
  component: CreatePolicySheet,
  parameters: {
    searchParams: { 'create-policy-sheet': 'true' },
  },
} satisfies Meta<typeof CreatePolicySheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
