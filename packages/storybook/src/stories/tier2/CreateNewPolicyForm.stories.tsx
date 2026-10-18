import type { Meta, StoryObj } from '@storybook/react';
import { CreateNewPolicyForm } from '../../../../../apps/app/src/components/forms/policies/create-new-policy';

const meta = {
  title: 'Tier 2 — CreateNewPolicyForm',
  component: CreateNewPolicyForm,
} satisfies Meta<typeof CreateNewPolicyForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
