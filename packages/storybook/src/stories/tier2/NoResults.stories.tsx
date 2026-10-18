import type { Meta, StoryObj } from '@storybook/react';
import { NoResults } from '../../../../../apps/app/src/components/tables/risk-register/empty-states';

const meta = {
  title: 'Tier 2 — NoResults',
  component: NoResults,
  parameters: {
    searchParams: { 'create-risk-sheet': 'true' },
  },
} satisfies Meta<typeof NoResults>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    hasFilters: false,
  },
};
