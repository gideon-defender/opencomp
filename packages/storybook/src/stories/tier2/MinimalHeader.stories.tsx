import type { Meta, StoryObj } from '@storybook/react';
import { MinimalHeader } from '../../../../../apps/app/src/components/layout/MinimalHeader';

const meta = {
  title: 'Tier 2 — MinimalHeader',
  component: MinimalHeader,
} satisfies Meta<typeof MinimalHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    user: { id: 'demo_id', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'), email: 'person@example.com', emailVerified: true, name: 'Example name' },
    variant: 'setup',
  },
};
