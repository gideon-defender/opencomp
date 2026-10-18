import type { Meta, StoryObj } from '@storybook/react';
import { AssignedUser } from '../../../../../apps/app/src/components/assigned-user';

const meta = {
  title: 'Tier 2 — AssignedUser',
  component: AssignedUser,
} satisfies Meta<typeof AssignedUser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    avatarUrl: 'https://example.com',
    fullName: 'Example name',
    date: '2026-01-01T00:00:00.000Z',
  },
};
