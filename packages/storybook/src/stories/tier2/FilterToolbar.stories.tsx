import type { Meta, StoryObj } from '@storybook/react';
import { FilterToolbar } from '../../../../../apps/app/src/components/tables/policies/filter-toolbar';

const meta = {
  title: 'Tier 2 — FilterToolbar',
  component: FilterToolbar,
  parameters: {
    searchParams: { 'create-policy-sheet': 'true' },
    viewport: { defaultViewport: 'mobile1' },
  },
} satisfies Meta<typeof FilterToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    users: [{ id: 'demo_id_1', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), email: 'person1@example.com', emailVerified: true, name: 'Example name 1' }, { id: 'demo_id_2', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), email: 'person2@example.com', emailVerified: true, name: 'Example name 2' }, { id: 'demo_id_3', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), email: 'person3@example.com', emailVerified: true, name: 'Example name 3' }],
    isEmpty: false,
  },
};
