import type { Meta, StoryObj } from '@storybook/react';
import { NoPolicies } from '../../../../../apps/app/src/components/tables/policies/empty-states';

const meta = {
  title: 'Tier 2 — NoPolicies',
  component: NoPolicies,
} satisfies Meta<typeof NoPolicies>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
